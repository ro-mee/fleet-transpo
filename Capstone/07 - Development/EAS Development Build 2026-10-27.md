---
type: development-log
status: build-finished-device-acceptance-pending
last_verified: 2026-10-27
---

# Android EAS development rebuild - 2026-10-27

The owner requested an EAS development rebuild. The intended source is merged local `main` at `511e72a4` in the `capstone-fuel-pdf` checkout, which contains the Android navigation/bubble module and the reconciled GPS lifecycle. The primary mechanic branch lacks that native module and was not selected for the build.

Verified the existing `development` profile: internal Android APK with `developmentClient: true`. EAS CLI 24.8.0 is installed and authenticated with owner access to `fleet23s-team`; project ID is `a3c14c6f-3fcd-41f4-acf8-36d37747fc5e`. The three most recent Android builds were finished builds from October 15; no duplicate pending rebuild was observed. Root and mobile upload exclusions retain environment/key/credential exclusions and permit the intended Firebase app configuration. The existing ignored Firebase configuration in the primary checkout matches Android package `com.fleet.mobile`; it is absent from the main checkout. No configuration values are recorded here.

The drive initially had no free space. Removed only the ignored, generated primary `.next/cache` after checking its resolved path and measuring it; recovered approximately 1.4 GB. No source or saved work was deleted.

The first submission attempt was rejected by automatic approval review because it required additional explicit permission for the private-source/Firebase upload. That attempt did not execute. The owner subsequently granted that permission, and the successful retry and final result are recorded below. The installed development client needs Metro to run the app.

Updated this note and `SYSTEM.md`; application code, build profiles, credentials and branches were not changed.

## Installation and development server

Install the development APK on the Android device after EAS reports FINISHED. Use Metro from the merged main checkout so its JavaScript matches the newly built native modules:

```powershell
cd C:\Users\lenovo\OneDrive\Desktop\capstone-fuel-pdf\mobile
npm start -- --dev-client --lan
```

The phone must be able to reach the development computer. The development profile does not bundle the preview/production API configuration; local development still needs the intended mobile environment and backend. Installation, phone connectivity, permissions, navigation and real-trip behavior require separate device checks.

## Explicit upload approval and submission

The owner explicitly approved uploading the private mobile source and existing Firebase app configuration to Expo EAS. The approved command supplied the matching ignored Firebase configuration in the main checkout and submitted the Android development build from `511e72a4` using the existing remote signing credentials. No profile, application source or signing credential was changed.

Submission succeeded. Build ID: 3cff0e51-cf97-49e6-8ccb-d901314ec484. EAS confirms Android/development and source commit 511e72a4c970180c15c403e10040695246ae46bf; created at 11:13 AM Asia/Manila on October 27. Build page: https://expo.dev/accounts/fleet23s-team/projects/mobile/builds/3cff0e51-cf97-49e6-8ccb-d901314ec484 . First status read: IN_PROGRESS, with no APK artifact yet.

## Final verified result

EAS reported **FINISHED** for build `3cff0e51-cf97-49e6-8ccb-d901314ec484` at **11:23 AM Asia/Manila on October 27, 2026**. Native Gradle compilation reported `BUILD SUCCESSFUL in 9m 20s`, including the local `fleetops-trip-bubble` module; `:app:assembleDebug` completed and EAS uploaded the APK artifact. No retry build or dependency upgrade was needed.

- [Download Android development APK](https://expo.dev/artifacts/eas/55Z_d5ibV3pfv9JI0VzmBiFNReAMOfEaCjyxEf6pZXo.apk)
- [EAS build details](https://expo.dev/accounts/fleet23s-team/projects/mobile/builds/3cff0e51-cf97-49e6-8ccb-d901314ec484)

This confirms cloud compilation and APK availability. Installation, runtime behavior and physical-device acceptance were not performed in this task. No backend deployment was performed.
