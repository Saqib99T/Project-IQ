# Project IQ Mobile — Signing Credentials

## EAS Account
- **Current Account**: saqibidrees
- **Previous Account**: sidrees73 (exhausted monthly build credits)
- **Project ID (saqibidrees)**: `901a18b4-87a8-4637-92ba-99a700f98984`
- **EAS Project URL**: https://expo.dev/accounts/saqibidrees/projects/project-iq-mobile

---

## Android

### Keystore File
- **File**: `expo-app/project-iq-release.jks` (keep this file safe — it's the original signing key)
- **Keystore Password**: `6367b1b0f159f2cd45386e8b93b22044`
- **Key Alias**: `c633a473d4aeaff9abe8ee13a737aa07`
- **Key Password**: `7edff7a237bdb9a3a7ac8c873cf89ae4`
- **SHA1 Fingerprint**: `51:F9:D0:09:73:A9:32:25:D2:F8:9E:82:FA:1F:60:D3:0B:A2:4D:1A`
- **Validity**: 2026-2056 (30 years)

### Status
- Keystore uploaded to EAS saqibidrees account via GraphQL API
- Google Play is linked to this SHA1 — never change the keystore

### Version Management
- **IMPORTANT**: In bare workflow (native `android/` dir exists), `app.json` android version fields are IGNORED
- Only update versions in: `android/app/build.gradle` (lines 95-96)
  - `versionCode` → integer (e.g. 12)
  - `versionName` → string (e.g. "1.0.12")

### Build Command
```bash
cd expo-app
eas build --platform android --profile production --clear-cache
```

---

## iOS

### Apple Developer Account
- **Apple Team ID**: `XJGZ2FPYC8`
- **Team Name**: Ninety Nine Technologies LLC
- **Apple ID**: `saqib.idrees@99technologies.com`
- **App Store Connect App ID**: `6761477401`
- **Bundle Identifier**: `com.projectiq.mobile`

### Distribution Certificate
- **Serial**: `610CDD60EBCABB0ACC924C56B77DA78B`
- **Valid Until**: 2027-03-29
- **Developer Portal ID**: `4T7X87X7W2`
- **EAS Cert ID (saqibidrees)**: `c3372428-70ee-430a-94c0-d7dc0ed48c91`
- Certificate p12 + password stored in EAS saqibidrees account (imported from sidrees73 via GraphQL)

### Provisioning Profile
- **Apple UUID**: `0602f987-60be-46c4-9abc-02eadeebe1ea`
- **Developer Portal ID**: `9AF9Z7Q9SU`
- **Valid Until**: 2027-03-29
- **Note**: Cannot be imported via API (Apple validates server-side). EAS will auto-generate on first build (requires Apple 2FA once)

### Status
- Distribution cert: ✅ Imported to saqibidrees EAS account
- Provisioning profile: ⚠️ Will be auto-created on first `eas build --platform ios`

### Build Command
```bash
cd expo-app
eas build --platform ios --profile production --clear-cache
```

---

## Switching EAS Accounts in the Future

If you switch EAS accounts again:

### Android (keystore transfer)
1. Log into old account, run GraphQL query to get `androidAppBuildCredentialsList.androidKeystore`
2. Extract `keystore`, `keystorePassword`, `keyAlias`, `keyPassword`
3. On new account: `AndroidKeystoreMutation.createAndroidKeystore` → get keystore ID
4. Link: `AndroidAppBuildCredentialsMutation.setKeystore(id, keystoreId)`

### iOS (cert transfer)
1. Log into old account, query `iosAppBuildCredentialsList.distributionCertificate`
2. Extract `certificateP12`, `certificatePassword`, `developerPortalIdentifier`, apple team ID
3. On new account: `AppleDistributionCertificateMutation.createAppleDistributionCertificate`
4. Create `IosAppCredentials` → `IosAppBuildCredentials` with cert
5. Provisioning profile: let EAS auto-create (1x Apple 2FA prompt)

### Key files to update when switching accounts
- `expo-app/app.json`: change `owner` and `extra.eas.projectId`
- Run `eas init --force` (while logged into new account) to get new projectId

---

## Google Play
- The SHA1 fingerprint above is registered with Google Play
- **Never** upload an APK/AAB signed with a different key — Google Play will reject it permanently
- If the .jks file is ever lost, the app cannot be updated on Google Play

## App Store Connect
- App ID `6761477401` is under Apple team `XJGZ2FPYC8`
- EAS submit config in `eas.json` points to correct Apple ID and ASC app ID
