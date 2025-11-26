# CI/CD Documentation

## Overview

The restorm project uses GitHub Actions for continuous integration and deployment. Three workflows have been configured to automate the build, test, and release processes across multiple platforms (Linux, Windows, and macOS).

## Workflows

### 1. Build and Test (`build.yml`)

**Triggers:**
- On pull requests to `main` branch
- On pushes to `main` branch

**Purpose:**
Validates code quality and ensures the application builds successfully before merging.

**Actions:**
- Runs on all three platforms in parallel (Linux, Windows, macOS)
- Installs dependencies with pnpm
- Runs ESLint with zero-warning policy
- Runs TypeScript type checking
- Builds the application using electron-vite

**Usage:**
This workflow runs automatically when you create or update a pull request. No manual intervention is required.

### 2. Preview Release (`preview-release.yml`)

**Triggers:**
- Manual trigger via GitHub Actions UI (`workflow_dispatch`)
- Can be run from any branch

**Purpose:**
Allows testing the complete release process before merging to main. Generates distributable binaries for all platforms without publishing them to GitHub Releases.

**Actions:**
- Builds distributable packages on all three platforms in parallel:
  - **Linux**: `.deb` and `.rpm` packages
  - **Windows**: `.exe` installer
  - **macOS**: `.zip` archive
- Uploads artifacts to GitHub Actions (available for download for 90 days)

**Usage:**

1. Go to the [Actions tab](https://github.com/yoanndiguet/restorm/actions) in your repository
2. Select "Preview Release (Manual)" from the workflows list
3. Click "Run workflow"
4. Select the branch you want to build from
5. Optionally specify a preview version number (default: `0.1.0-preview`)
6. Click "Run workflow"
7. Wait for the builds to complete (typically 10-20 minutes)
8. Download the artifacts from the workflow run page

**Testing the Preview:**
After running this workflow on the `yoanndiguet/oyo-37-cicd-build` branch, you can:
- Download the generated binaries for each platform
- Test the installation process
- Verify that the application runs correctly
- Confirm that all platforms build successfully

### 3. Auto Version Bump (`auto-version.yml`)

**Triggers:**
- Automatically on every merge to `main` branch
- Manual trigger via GitHub Actions UI with version type selection

**Purpose:**
Automatically increments the version number in `package.json`, commits the change, creates a tag, and triggers the release workflow.

**Actions:**
- Detects the current version from `src/package.json`
- Determines the version bump type:
  - **Automatic (on merge)**: Increments `patch` by default
  - **From commit message**: Use `[minor]` or `[major]` in the commit message to change the bump type
  - **Manual trigger**: Select `patch`, `minor`, or `major` from the workflow UI
- Increments the version following semantic versioning
- Commits the updated `package.json` with message `chore: bump version to X.Y.Z`
- Creates and pushes a new tag `vX.Y.Z`
- The new tag automatically triggers the Release Production workflow

**Usage:**

**Automatic (recommended):**
When you merge a PR to `main`, the workflow runs automatically:
- Default: increments patch version (0.1.2 → 0.1.3)
- Include `[minor]` in commit message for minor bump (0.1.3 → 0.2.0)
- Include `[major]` in commit message for major bump (0.2.0 → 1.0.0)

**Manual trigger:**
1. Go to the [Actions tab](https://github.com/oYo-fr/restorm/actions)
2. Select "Auto Version Bump" workflow
3. Click "Run workflow"
4. Select the version type (`patch`, `minor`, or `major`)
5. Click "Run workflow"

**Example:**
```bash
# Merge a PR - automatic patch bump
git merge feature-branch
# Result: 0.1.2 → 0.1.3, tag v0.1.3 created, release triggered

# Merge with minor bump
git merge feature-branch -m "feat: add new feature [minor]"
# Result: 0.1.3 → 0.2.0, tag v0.2.0 created, release triggered
```

### 4. Release Production (`release.yml`)

**Triggers:**
- When a tag matching `v*` is pushed (e.g., `v1.0.0`, `v0.2.1`)
- When code is merged to the `main` branch

**Purpose:**
Creates official releases and publishes distributable binaries to GitHub Releases.

**Actions:**

**On Tag Push:**
- Creates a new GitHub Release with the tag name
- Builds distributable packages on all three platforms in parallel
- Uploads all packages to the GitHub Release:
  - **Linux**: `.deb` and `.rpm` packages
  - **Windows**: `.exe` installer
  - **macOS**: `.zip` archive
- Generates release notes automatically

**On Main Branch Merge:**
- Builds the application on Linux only
- Uploads artifacts to GitHub Actions (available for 30 days)
- Does not create a GitHub Release

**Usage:**

**To create a release with a tag:**

```bash
# Make sure you're on the main branch
git checkout main
git pull

# Create and push a tag
git tag -a v1.0.0 -m "Release version 1.0.0"
git push origin v1.0.0
```

The workflow will automatically:
1. Create a GitHub Release
2. Build binaries for all platforms
3. Upload them to the release

**To build after merging:**
Simply merge a pull request to `main`. The workflow will run automatically and build the Linux version.

## Platform-Specific Details

### Linux Build

**Outputs:**
- `.deb` package (Debian/Ubuntu)
- `.rpm` package (Fedora/RHEL/CentOS)

**Requirements:**
- Ubuntu latest runner
- rpm tools installed via apt-get

### Windows Build

**Outputs:**
- `.exe` installer (Squirrel.Windows)

**Requirements:**
- Windows latest runner
- Visual Studio Build Tools (pre-installed on GitHub runners)

### macOS Build

**Outputs:**
- `.zip` archive containing the `.app` bundle

**Requirements:**
- macOS latest runner

**Note:** Code signing and notarization are not yet configured. To add them in the future, you'll need to:
- Configure Apple Developer certificates
- Add signing secrets to GitHub repository settings
- Update the electron-forge configuration

## Build Times

Approximate build times per platform (may vary):
- **Linux**: 8-12 minutes
- **Windows**: 10-15 minutes
- **macOS**: 10-15 minutes

Builds run in parallel, so total time is approximately equal to the longest individual build.

## Caching Strategy

All workflows use pnpm caching to speed up builds:
- The pnpm store directory is cached between runs
- Cache key is based on the `pnpm-lock.yaml` hash
- Significantly reduces dependency installation time

## Troubleshooting

### Build Fails on PR

**Problem:** The build workflow fails when creating a pull request.

**Solutions:**
1. Check the linter output: `cd src && pnpm run lint`
2. Fix any TypeScript errors: `cd src && pnpm run typecheck`
3. Ensure all dependencies are installed: `pnpm install`
4. Test the build locally: `cd src && pnpm run build`

### Preview Release Artifacts Not Generated

**Problem:** The preview release workflow completes but no artifacts are available.

**Solutions:**
1. Check the workflow logs for errors during the `make` step
2. Ensure electron-forge is properly configured in `forge.config.js`
3. Verify that the `out/make` directory is created during the build
4. Check that the artifact paths in the workflow match the actual output paths

### Release Workflow Doesn't Trigger

**Problem:** Pushing a tag doesn't trigger the release workflow.

**Solutions:**
1. Ensure the tag matches the pattern `v*` (e.g., `v1.0.0`)
2. Verify that the workflow file is on the branch where the tag is created
3. Check GitHub Actions permissions in repository settings
4. Look for workflow run errors in the Actions tab

### macOS Signing Issues

**Problem:** macOS build completes but the app is not signed.

**Current Status:** Code signing is not yet configured. The unsigned app will work but will show security warnings when opened.

**Future Solution:** Configure Apple Developer certificates and update the forge configuration.

### Application Shows Blank White Screen

**Problem:** After installing the application from a release, it opens but displays only a blank white screen. DevTools cannot be opened.

**Root Cause:** The renderer output directory was not configured in `electron-vite.config.ts`, causing the renderer to be built to `out/renderer/` instead of `dist/renderer/` where the main process expects it.

**Solution (Applied in v0.1.1):**

1. **Fix renderer output directory:**
   - Added `outDir: 'dist/renderer'` to the renderer configuration in `src/electron.vite.config.ts`
   - This ensures the renderer is built to the correct location expected by the main process

2. **Configure DevTools for production:**
   - DevTools are disabled by default in production for security
   - Can be enabled with `--enable-dev-tools` command line flag
   - Keyboard shortcuts (F12, Ctrl+Shift+I) work only when DevTools are enabled

**Verification:**
```bash
cd src
pnpm run build
# Verify that dist/renderer/ exists with index.html and assets
pnpm run package
# Test the application
```

**Prevention:**
Always test local builds with `pnpm run package` before creating a release to catch packaging issues early.

### DevTools in Production Builds

**Behavior:**

By default, DevTools are completely disabled in production builds for security reasons:
- Keyboard shortcuts (F12, Ctrl+Shift+I) are disabled
- Menu bar is hidden
- DevTools cannot be accessed through any standard method

**Enabling DevTools for Debugging:**

If you need to debug a production build, you can re-enable DevTools by passing the `--enable-dev-tools` flag:

```bash
# Linux/macOS
restorm --enable-dev-tools

# Windows
restorm.exe --enable-dev-tools

# From installed location
/opt/restorm/restorm --enable-dev-tools
```

When enabled with the flag:
- Menu bar becomes visible
- Keyboard shortcuts work (F12, Ctrl+Shift+I, Cmd+Alt+I)
- DevTools can be toggled normally

**Development builds:**
DevTools are always enabled in development mode (`pnpm run dev`).

**Use cases for `--enable-dev-tools`:**
- Debugging production-specific issues
- Investigating user-reported bugs
- Testing the production build locally
- Inspecting the packaged application behavior

**Security note:**
Never distribute a build with DevTools permanently enabled, as it could expose sensitive information or allow users to modify the application behavior.

## Security Considerations

### GitHub Token Permissions

The workflows use `GITHUB_TOKEN` which is automatically provided by GitHub Actions. This token has permissions to:
- Read repository contents
- Create releases
- Upload assets to releases

No additional secrets are required for basic functionality.

### Future Enhancements

To add code signing:
- **macOS:** Add `APPLE_ID`, `APPLE_PASSWORD`, and signing certificates
- **Windows:** Add code signing certificate
- **Linux:** Consider GPG signing for packages

## File Structure

```
.github/
└── workflows/
    ├── build.yml              # Build and test on PR
    ├── preview-release.yml    # Manual preview release
    └── release.yml            # Production release
```

## Dependencies

The workflows use the following GitHub Actions:
- `actions/checkout@v4` - Checks out the repository
- `actions/setup-node@v4` - Sets up Node.js environment
- `pnpm/action-setup@v2` - Sets up pnpm package manager
- `actions/cache@v3` - Caches pnpm store
- `actions/upload-artifact@v3` - Uploads build artifacts
- `softprops/action-gh-release@v1` - Creates GitHub releases

## Monitoring

To monitor the CI/CD pipelines:
1. Go to the [Actions tab](https://github.com/yoanndiguet/restorm/actions)
2. View recent workflow runs
3. Click on any run to see detailed logs
4. Download artifacts from completed runs

## Maintenance

### Updating Workflows

To modify the workflows:
1. Edit the YAML files in `.github/workflows/`
2. Test changes on a feature branch first
3. Use the preview release workflow to validate
4. Merge to main once confirmed working

### Updating Dependencies

When updating build dependencies:
1. Update `package.json` and `pnpm-lock.yaml`
2. Test locally
3. Create a PR to trigger the build workflow
4. Ensure all platforms build successfully

## Contact & Support

For issues related to CI/CD:
- Check the troubleshooting section above
- Review workflow logs in GitHub Actions
- Contact the development team

---

*Last updated: 2025-10-11*
*Ticket: OYO-37 - CI/CD Build*

