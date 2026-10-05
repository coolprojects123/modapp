# Electron Binary Signing Guide

This guide explains how to sign your modapp Electron binaries to prevent security warnings and enable Widevine DRM support.

## Quick Start

```bash
# Sign Windows build
npm run sign:windows

# Sign macOS build  
npm run sign:mac

# Sign Linux build (experimental)
npm run sign:linux
```

## Configuration

### 1. Standard Code Signing (Required for distribution)

#### Windows (Authenticode)
- **Certificate**: DigiCert, Sectigo, or Comodo code signing certificate (.p12 file)
- **Environment Variables**:
  ```bash
  export WIN_CSC_LINK="/path/to/your/certificate.p12"
  export WIN_CSC_KEY_PASSWORD="your-certificate-password"
  ```

#### macOS (Gatekeeper)
- **Certificate**: Apple Developer ID Application certificate
- **Environment Variables**:
  ```bash
  export CSC_LINK="/path/to/your/certificate.p12"
  export CSC_KEY_PASSWORD="your-certificate-password"
  # Optional: specific identity
  export CSC_IDENTITY_AUTO_DISCOVERY="false"
  export CSC_IDENTITY="Developer ID Application: Your Name (123ABC)"
  ```

#### Linux
- Code signing is not commonly required for Linux
- Distribution through package managers (deb, rpm, AppImage) is sufficient

### 2. Widevine DRM Signing (Optional, for Spotify, Netflix, etc.)

For Widevine DRM support (needed for sites like Spotify, Netflix):
- **castLabs EVS Account**: Required for Widevine content playback
- **Environment Variables**:
  ```bash
  export EVS_ACCOUNT_NAME="your-castlabs-email@example.com"
  export EVS_PASSWD="your-castlabs-password"
  ```

Alternatively, authenticate once on your development machine:
```bash
# Install castlabs_evs
pip install castlabs-evs

# Authenticate (saves credentials in ~/.castlabs_evs)
python -m castlabs_evs.account reauth
```

## Build and Sign Process

### Development Build
```bash
# Build without signing (for development)
npm run build
```

### Production Build with Signing
```bash
# Option 1: Build and sign in one step
export WIN_CSC_LINK="/path/to/cert.p12"
export WIN_CSC_KEY_PASSWORD="password"
npm run build:windows

# Option 2: Build first, then sign
export WIN_CSC_LINK="/path/to/cert.p12"
export WIN_CSC_KEY_PASSWORD="password"
npm run build:windows
npm run sign:windows
```

## Platform-Specific Notes

### Windows
- Signing is required for SmartScreen filtering
- Without signing, users see "Windows protected your PC" warnings
- Use DigiCert, Sectigo, or other trusted certificate authorities

### macOS
- Signing is required for Gatekeeper
- Without signing, users see "App can't be opened" warnings
- Use Apple Developer ID certificates from Apple Developer Portal
- Notarization is recommended in addition to signing

### Linux
- Signing is optional but recommended for distribution
- AppImage, deb, and rpm packages are typically sufficient

## Environment Configuration

### .env file (recommended)
Create a `.env` file in your project root:
```env
# Windows signing
WIN_CSC_LINK=./certs/windows.p12
WIN_CSC_KEY_PASSWORD=your_password

# macOS signing
CSC_LINK=./certs/macos.p12
CSC_KEY_PASSWORD=your_password

# Widevine DRM (castLabs EVS)
EVS_ACCOUNT_NAME=your_email@example.com
EVS_PASSWD=your_password
```

### GitHub Actions
For CI/CD signing in GitHub Actions:

```yaml
- name: Build and sign Electron app
  env:
    WIN_CSC_LINK: ${{ secrets.WIN_CERT_P12_BASE64 }}
    WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CERT_PASSWORD }}
    CSC_LINK: ${{ secrets.MAC_CERT_P12_BASE64 }}
    CSC_KEY_PASSWORD: ${{ secrets.MAC_CERT_PASSWORD }}
    EVS_ACCOUNT_NAME: ${{ secrets.EVS_ACCOUNT_NAME }}
    EVS_PASSWD: ${{ secrets.EVS_PASSWD }}
  run: |
    npm run build:windows
    npm run sign:windows
```

Note: For GitHub Actions, you need to base64 encode your .p12 files:
```bash
base64 -w 0 cert.p12 > cert.b64
```

## Troubleshooting

### "No certificates were found for signing"
- Verify your certificate paths are correct
- Check that your .p12 files are valid
- Ensure environment variables are set correctly

### "Code signing failed"
- Check that your certificate password is correct
- Verify your certificate hasn't expired
- Ensure you have the private key included in the .p12 file

### "EVS signing failed"
- Verify your castLabs credentials are correct
- Check that you have an active castLabs EVS subscription
- Ensure your Electron version supports Widevine (castLabs fork required)

### "appOutDir is not defined"
- Run `npm run build` before `npm run sign`
- Ensure the build directory exists

## Additional Resources

- [electron-builder Code Signing](https://www.electron.build/code-signing)
- [castLabs EVS Documentation](https://docs.castlabs.io/electron/widevine/)
- [Apple Developer ID Certificates](https://developer.apple.com/developer-id/)
- [Windows Code Signing](https://learn.microsoft.com/en-us/dotnet/framework/tools/signtool-exe)

## Security Best Practices

1. **Never commit certificate files** to version control
2. **Use GitHub Secrets** or other secure storage for certificate passwords
3. **Rotate certificates** regularly
4. **Use separate certificates** for development and production
5. **Limit access** to signing keys and certificates