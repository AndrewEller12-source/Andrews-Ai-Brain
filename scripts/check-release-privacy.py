#!/usr/bin/env python3
"""Fail closed on private material in final ZIP bytes; policy stays off-repo.

This gate complements, and never replaces, clean-account and tenant-access tests.
Reports contain rule IDs and entry paths, never matching content or credentials.
"""
import argparse
import datetime
import hashlib
import io
import json
import pathlib
import posixpath
import re
import stat
import zipfile

import subprocess
import tempfile
from urllib.parse import urlsplit


MAX_EXPANDED = 2 * 1024**3
MAX_ENTRY = 256 * 1024**2
PRIVATE_NAMES = {'.env', 'auth.json', 'account-profile.json', 'rewster-integration.token', 'projects.json'}
PRIVATE_DIRS = {'.local', '.codex', 'xcuserdata'}
SECRET_RULES = {
    'private_key': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'api_credential': re.compile(rb'(?<![A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{32,}'),
    'api_credential_utf16le': re.compile(rb'(?<![A-Za-z0-9_-]\x00)s\x00k\x00-\x00(?:[A-Za-z0-9_-]\x00){32,}'),
    'api_credential_utf16be': re.compile(rb'(?<!\x00[A-Za-z0-9_-])\x00s\x00k\x00-(?:\x00[A-Za-z0-9_-]){32,}'),
}


def read_policy(file, requirements_file):
    policy = json.loads(pathlib.Path(file).read_text())
    terms = policy.get('forbidden_literals')
    if not isinstance(terms, list) or not terms:
        raise ValueError('A nonempty private forbidden_literals policy is required')
    if any(not isinstance(t, str) or len(t.strip()) < 4 for t in terms):
        raise ValueError('Every private policy term must contain at least four characters')
    requirements = json.loads(pathlib.Path(requirements_file).read_text())
    required = requirements.get('required_forbidden_literal_sha256')
    if not isinstance(required, list) or not required or any(not isinstance(x, str) or not re.fullmatch(r'[0-9a-f]{64}', x) for x in required):
        raise ValueError('A valid nonempty release privacy requirement set is required')
    supplied = {hashlib.sha256(t.strip().casefold().encode()).hexdigest() for t in terms}
    if not set(required).issubset(supplied):
        raise ValueError('The private policy does not cover every mandatory release identity')
    return terms, hashlib.sha256(pathlib.Path(requirements_file).read_bytes()).hexdigest()



def read_public_urls(file):
    urls = json.loads(pathlib.Path(file).read_text()).get('allowed_public_urls', [])
    if not isinstance(urls, list):
        raise ValueError('Public URL exceptions must be an explicit list')
    for value in urls:
        if not isinstance(value, str):
            raise ValueError('Invalid public URL exception')
        url = urlsplit(value)
        if (url.scheme != 'https' or url.hostname != 'github.com' or url.username
                or url.password or url.query or url.fragment or url.port
                or not re.fullmatch(r'/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/releases/(?:latest/download|download/v[0-9.]+)/[A-Za-z0-9_.-]+', url.path)):
            raise ValueError('Only exact GitHub release asset URLs may be excepted')
    return urls


def public_url_redacted(data, urls):
    # Exceptions apply only to whole approved URLs, never names, paths or credentials.
    result = data
    for url in urls:
        for encoding in ('utf-8', 'utf-16le', 'utf-16be'):
            token = url.lower().encode(encoding)
            if token not in result:
                continue
            boundary = b'|'.join(re.escape(c.encode(encoding)) for c in 'abcdefghijklmnopqrstuvwxyz0123456789_./?%#@&=+-:')
            result = re.sub(b'(?<![a-z0-9:/])' + re.escape(token) + b'(?!(?:' + boundary + b'))', b'', result)
    return result


def audit_package(file, terms, public_urls):
    # Inspect the payload extracted from the exact signed package, not a pre-package folder.
    with tempfile.TemporaryDirectory(prefix='task-manager-pkg-audit-') as temporary:
        expanded = pathlib.Path(temporary) / 'expanded'
        subprocess.run(['/usr/sbin/pkgutil', '--expand-full', str(pathlib.Path(file).resolve()), str(expanded)],
                       check=True, capture_output=True, timeout=180)
        archive = pathlib.Path(temporary) / 'payload.zip'
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_STORED) as output:
            for entry in sorted(expanded.rglob('*')):
                relative = entry.relative_to(expanded).as_posix()
                if entry.is_symlink():
                    info = zipfile.ZipInfo(relative)
                    info.create_system = 3
                    info.external_attr = (stat.S_IFLNK | 0o777) << 16
                    output.writestr(info, str(entry.readlink()))
                elif entry.is_file():
                    output.write(entry, relative)
                elif not entry.is_dir():
                    raise ValueError('Unsupported package payload entry')
        result = audit(archive, terms, public_urls)
        result['artifact'] = pathlib.Path(file).name
        result['sha256'] = hashlib.sha256(pathlib.Path(file).read_bytes()).hexdigest()
        result['format'] = 'expanded-package'
        return result

def audit(file, terms, public_urls=()):
    if pathlib.Path(file).suffix.lower() == ".pkg":
        return audit_package(file, terms, public_urls)
    needles = [(f'private_literal_{i + 1}', tuple(t.lower().encode(enc) for enc in ('utf-8', 'utf-16le', 'utf-16be')))
               for i, t in enumerate(terms)]
    findings = []
    expanded = 0
    entries = 0

    def inspect(archive, prefix='', depth=0):
        nonlocal expanded, entries
        if depth > 3:
            raise ValueError('Nested archive depth exceeded')
        with zipfile.ZipFile(archive) as z:
            for entry in z.infolist():
                entries += 1
                name = prefix + entry.filename
                parts = pathlib.PurePosixPath(entry.filename).parts
                rules = set()
                if entry.filename.startswith(('/', '\\')) or '..' in parts or '\\' in entry.filename:
                    rules.add('unsafe_archive_path')
                if any(p.lower() in PRIVATE_DIRS for p in parts) or (parts and (parts[-1].lower() in PRIVATE_NAMES or parts[-1].lower().startswith('.env.'))):
                    rules.add('private_state_filename')
                if entry.file_size > MAX_ENTRY or expanded + entry.file_size > MAX_EXPANDED:
                    raise ValueError('Archive inspection size limit exceeded')
                expanded += entry.file_size
                data = z.read(entry)  # CRC/encryption errors must fail the gate.
                lower = public_url_redacted(data.lower(), public_urls)
                lower_name = name.lower().encode('utf-8')
                for rule, encodings in needles:
                    if encodings[0] in lower_name or any(term in lower for term in encodings):
                        rules.add(rule)
                for rule, expression in SECRET_RULES.items():
                    if expression.search(data):
                        rules.add(rule)
                for key_type in ('', 'RSA ', 'EC ', 'OPENSSH '):
                    marker = '-----BEGIN ' + key_type + 'PRIVATE KEY-----'
                    if any(marker.encode(enc) in data for enc in ('utf-16le', 'utf-16be')):
                        rules.add('private_key')
                if stat.S_ISLNK(entry.external_attr >> 16):
                    target = data.decode('utf-8')
                    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(entry.filename), target))
                    if target.startswith(('/', '\\')) or resolved == '..' or resolved.startswith('../'):
                        rules.add('escaping_archive_symlink')
                if rules:
                    findings.append({'entry': name, 'rules': sorted(rules)})
                if data.startswith(b'PK\x03\x04') and zipfile.is_zipfile(io.BytesIO(data)):
                    inspect(io.BytesIO(data), name + '!/', depth + 1)

    if zipfile.is_zipfile(file):
        inspect(file)
    else:
        if pathlib.Path(file).suffix.lower() != '.xml':
            raise ValueError('Only valid ZIP archives and XML release feeds are supported')
        data = pathlib.Path(file).read_bytes()
        if len(data) > MAX_ENTRY:
            raise ValueError('File inspection size limit exceeded')
        entries = 1
        expanded = len(data)
        lower = public_url_redacted(data.lower(), public_urls)
        lower_name = pathlib.Path(file).name.lower().encode('utf-8')
        rules = set()
        for rule, encodings in needles:
            if encodings[0] in lower_name or any(term in lower for term in encodings):
                rules.add(rule)
        for rule, expression in SECRET_RULES.items():
            if expression.search(data):
                rules.add(rule)
        if rules:
            findings.append({'entry': pathlib.Path(file).name, 'rules': sorted(rules)})
    hasher = hashlib.sha256()
    with pathlib.Path(file).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            hasher.update(chunk)
    digest = hasher.hexdigest()
    return {'artifact': pathlib.Path(file).name, 'sha256': digest, 'entries_checked': entries,
            'expanded_bytes': expanded, 'status': 'fail' if findings else 'pass', 'findings': findings}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--policy', required=True)
    parser.add_argument('--requirements', default=str(pathlib.Path(__file__).resolve().parents[1] / 'release-privacy-requirements.json'))
    parser.add_argument('--report', required=True)
    parser.add_argument('archives', nargs='+')
    args = parser.parse_args()
    try:
        terms, requirements_sha256 = read_policy(args.policy, args.requirements)
        public_urls = read_public_urls(args.policy)
        artifacts = [audit(file, terms, public_urls) for file in args.archives]
        report = {'status': 'fail' if any(a['status'] != 'pass' for a in artifacts) else 'pass',
                  'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'policy_sha256': hashlib.sha256(pathlib.Path(args.policy).read_bytes()).hexdigest(),
                  'requirements_sha256': requirements_sha256,
                  'scope': 'Archive bytes and metadata only; customer isolation is a separate release gate',
                  'artifacts': artifacts}
    except Exception as error:
        # Exception text could contain sensitive paths or archive contents.
        report = {'status': 'error', 'error_type': type(error).__name__}
    pathlib.Path(args.report).write_text(json.dumps(report, indent=2) + '\n')
    print('Release privacy gate: ' + report['status'])
    return 0 if report['status'] == 'pass' else 1


if __name__ == '__main__':
    raise SystemExit(main())
