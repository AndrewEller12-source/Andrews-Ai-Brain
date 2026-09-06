# Ai Task Manager — native Apple apps

Open `AndrewsAiBrain.xcodeproj` in Xcode. The shared **Mac** and **iPhone** schemes build the native shells. The **Dashboard source (edit here)** group points to the actual JavaScript, HTML, CSS, backend, and root documentation; the generated `Runtime` resource is a staged copy and is overwritten during staging.

See `../APPLE-APPS.md` for runtime staging, local installation, phone pairing, and physical-device signing instructions. The current bundled runtime is for Apple Silicon Macs. The iPhone app connects to an online Mac on the same network; it does not run the Codex runtime on the phone.

## Native verification

From the `command-center` directory:

```sh
xcrun swiftc apple/Shared/Pairing.swift apple/Tests/PairingSmoke.swift -o /tmp/andrews-brain-pairing-smoke
/tmp/andrews-brain-pairing-smoke
xcodebuild -project apple/AndrewsAiBrain.xcodeproj -scheme Mac -configuration Release -derivedDataPath apple/build/Mac CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- build
xcodebuild -project apple/AndrewsAiBrain.xcodeproj -scheme iPhone -destination 'generic/platform=iOS Simulator' -derivedDataPath apple/build/iPhone CODE_SIGNING_ALLOWED=NO build
```

The standalone Swift smoke checks pairing field validation, HTTPS-only addresses, matching and mismatched certificate fingerprints, and Secure/HttpOnly cookie properties. Device provisioning and a physical iPhone test remain separate from simulator compilation and launch. Ad-hoc local Mac signing is not Developer ID signing or Apple notarization.

The original app icons are generated from vector paths with `xcrun swift apple/Tools/generate-icon.swift apple`. No third-party artwork is used.
