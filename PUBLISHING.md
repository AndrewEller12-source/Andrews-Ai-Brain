# Publishing Ai Task Manager updates

The Mac app checks the release-specific `appcast.xml` URL supplied at native build
time. Recipients install once; later updates are offered inside the app and
Workspace > Check for updates checks immediately. Unpublished local edits do not
reach recipients.

1. Increment package.json and both Xcode versions. CFBundleVersion must strictly increase.
2. Run tests, stage the runtime with `npm run apple:stage`, and build the Mac Release
   scheme using Xcode. Verify the native app and a clean recipient workspace.
3. Run `python3 -m unittest discover -s tests -p 'test_release_privacy.py'`.
   Supply `REWSTER_RELEASE_PRIVACY_POLICY` pointing to a private, off-repository JSON
   file with a nonempty `forbidden_literals` array covering the owner's identifiers,
   private business domains, account addresses and private deployment references.
   `release-privacy-requirements.json` pins the required policy terms by normalized
   SHA-256 so a weaker replacement policy fails without publishing the private terms.
   Never commit or package that policy. Verify an empty fresh customer installation
   uses only that customer's login and data; an archive scan cannot prove account isolation.
   Set `REWSTER_UPDATE_FEED_URL` to the exact public HTTPS appcast URL and
   `REWSTER_RELEASE_DOWNLOAD_PREFIX` to the version-specific HTTPS download directory.
   Both values must match the built app; the explicitly approved temporary publisher
   exception below is the only permitted owner identifier.
   Commit reviewed source. Run `node scripts/prepare-update.mjs [built-app-path] [Sparkle-bin-path]`.
   This produces an app ZIP, editable source ZIP, signed appcast and SHA256SUMS.txt
   in `dist/publish-VERSION`. Signatures use the `ai-task-manager-releases` Keychain account.
   Never export its private key into this repository or upload it to a release.
   Both final ZIPs, the migration package, and both generated appcasts must pass the privacy gate. Missing or
   incomplete policy, unreadable archives and matches fail closed; do not suppress a
   match to force a release.
   Existing output directories are never overwritten. The internal privacy receipt
   stays outside the public asset directory. A changed updater publisher requires a
   verified migration for existing installations; do not silently break their feed.
4. Create a GitHub release tagged `vVERSION`. Upload all six assets without renaming
   them. Keep it a draft until all uploads and checks finish; then publish as latest.
5. Verify the public feed and download hashes. Test upgrading a lower build of the app.
   Never replace the bytes of an already published version; publish a higher version.

Update installation waits while dashboard requests are queued, running or awaiting
approval. It preserves local account and workspace data outside the application bundle.
The independent Codex desktop app is not stopped. Source stays editable in the checkout
and in each source archive. This build includes an Apple silicon runtime, requires macOS
14+, and is ad-hoc signed (not Apple-notarized). Sparkle verifies Ed25519 update signatures.

If the signing Mac is lost, recover its Keychain from a secure backup. A new unrelated
key cannot sign an update trusted by existing installations.

A temporarily approved personal publisher is permitted only through exact HTTPS
GitHub release asset URLs listed in the private policy as allowed_public_urls.
This does not exempt personal names elsewhere, bundle identifiers, local paths,
customer records, credentials, or files. All mandatory forbidden terms remain
pinned. The owner approved temporary personal-account publishing on 2026-09-08.
Neutral bundle identity migration uses a signed package offered by the legacy
feed; subsequent updates use appcast-neutral.xml and normal app archives.
Package installation requires the standard macOS administrator authorization.
