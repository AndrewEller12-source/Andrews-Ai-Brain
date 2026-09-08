import importlib.util
import io
import json
import pathlib
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'scripts/check-release-privacy.py'
spec = importlib.util.spec_from_file_location('release_privacy', SCRIPT)
privacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(privacy)


class ReleasePrivacyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)

    def archive(self, entries):
        file = self.root / 'app.zip'
        with zipfile.ZipFile(file, 'w') as z:
            for name, value in entries:
                z.writestr(name, value)
        return file

    def test_clean_recipient_archive_passes(self):
        result = privacy.audit(self.archive([('app/runtime.mjs', 'const home = os.homedir();')]), ['PRIVATE_OWNER_SENTINEL'])
        self.assertEqual(result['status'], 'pass')

    def test_owner_data_in_binary_and_utf16_is_blocked(self):
        for encoding in ('utf-8', 'utf-16le', 'utf-16be'):
            with self.subTest(encoding=encoding):
                result = privacy.audit(self.archive([('app/binary', b'\x00\xff' + 'Private_Owner_Sentinel'.encode(encoding))]), ['private_owner_sentinel'])
                self.assertEqual(result['status'], 'fail')
                self.assertNotIn('Private_Owner_Sentinel', json.dumps(result))

    def test_private_state_and_unsafe_paths_blocked(self):
        for name in ('app/.codex/auth.json', 'app/.env', 'app/.local/state.json', '../outside'):
            with self.subTest(name=name):
                self.assertEqual(privacy.audit(self.archive([(name, '{}')]), ['SENTINEL'])['status'], 'fail')

    def test_nested_archive_is_scanned(self):
        nested = io.BytesIO()
        with zipfile.ZipFile(nested, 'w') as z:
            z.writestr('data.bin', 'PRIVATE_OWNER_SENTINEL')
        result = privacy.audit(self.archive([('payload.zip', nested.getvalue())]), ['PRIVATE_OWNER_SENTINEL'])
        self.assertEqual(result['status'], 'fail')
        self.assertTrue(any('!/' in x['entry'] for x in result['findings']))

    def test_symlinks_allow_internal_frameworks_and_reject_escape(self):
        info = zipfile.ZipInfo('app/Framework/Current')
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        self.assertEqual(privacy.audit(self.archive([(info, 'Versions/B')]), ['SENTINEL'])['status'], 'pass')
        self.assertEqual(privacy.audit(self.archive([(info, '../../../private')]), ['SENTINEL'])['status'], 'fail')

    def test_secret_not_echoed(self):
        secret = 'sk-proj-' + 'x' * 40
        for encoding in ('utf-8', 'utf-16le', 'utf-16be'):
            with self.subTest(encoding=encoding):
                result = privacy.audit(self.archive([('app/config.js', secret.encode(encoding))]), ['SENTINEL'])
                self.assertEqual(result['status'], 'fail')
                self.assertNotIn(secret, json.dumps(result))

    def test_binary_symbols_are_not_misclassified_as_credentials(self):
        symbol = b'task-' + b'x' * 40
        separated = b'\x00'.join([b'task', b'name', b'config', b'x' * 40])
        result = privacy.audit(self.archive([('app/binary', symbol + b'\x00' + separated)]), ['SENTINEL'])
        self.assertEqual(result['status'], 'pass')

    def test_cli_missing_policy_or_corrupt_archive_fails_closed(self):
        policy = self.root / 'policy.json'
        report = self.root / 'report.json'
        archive = self.root / 'broken.zip'
        archive.write_text('not an archive')
        for value in ({}, {'forbidden_literals': []}, {'forbidden_literals': ['SENTINEL']}):
            policy.write_text(json.dumps(value))
            result = subprocess.run([sys.executable, str(SCRIPT), '--policy', str(policy), '--report', str(report), str(archive)], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(json.loads(report.read_text())['status'], 'error')


if __name__ == '__main__':
    unittest.main()
