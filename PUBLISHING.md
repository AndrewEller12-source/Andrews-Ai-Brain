# Publishing Ai Task Manager updates

The Mac app checks the `appcast.xml` asset on the latest published release of
https://github.com/AndrewEller12-source/Andrews-Ai-Brain . Recipients install version
0.7.0 once. Later updates are offered inside the app; Workspace > Check for updates
checks immediately. Unpublished local edits do not reach recipients.

1. Increment package.json and both Xcode versions. CFBundleVersion must strictly increase.
2. Run tests, stage the runtime with `npm run apple:stage`, and build the Mac Release
   scheme using Xcode. Verify the native app and a clean recipient workspace.
3. Run `python3 -m unittest discover -s tests -p 'test_release_privacy.py'`.
   Supply `REWSTER_RELEASE_PRIVACY_POLICY` pointing to a private, off-repository JSON
   file with a nonempty `forbidden_literals` array covering the owner's identifiers,
   private business domains, account addresses and private deployment references.
   Never commit or package that policy. Verify an empty fresh customer installation
   uses only that customer's login and data; an archive scan cannot prove account isolation.
   Commit reviewed source. Run `node scripts/prepare-update.mjs [built-app-path] [Sparkle-bin-path]`.
   This produces an app ZIP, editable source ZIP, signed appcast and SHA256SUMS.txt
   in `dist/publish-VERSION`. Signatures use the `ai-task-manager-releases` Keychain account.
   Never export its private key into this repository or upload it to a release.
   Both final ZIPs must pass the privacy gate before signing. Missing policy, unreadable
   archives and matches fail closed; do not suppress a match to force a release.
   Existing output directories are never overwritten. The internal privacy receipt
   stays outside the public asset directory. A changed updater publisher requires a
   verified migration for existing installations; do not silently break their feed.
4. Create a GitHub release tagged `vVERSION`. Upload all four assets without renaming
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
