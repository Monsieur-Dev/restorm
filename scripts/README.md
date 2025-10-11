# X11 Virtual Display Setup

This directory contains scripts to set up a virtual X11 display server for running Electron applications in headless environments (like dev containers).

## 🎯 Purpose

Electron applications require a graphical display to run. In headless environments (dev containers, CI/CD, servers), we need to create a virtual display server to allow Electron apps to function.

## 📋 Prerequisites

The following packages are required (installed by the dev container setup):

- `xvfb` - X Virtual Framebuffer
- `x11-utils` - X11 utilities
- `dbus-x11` - D-Bus for X11

## 🚀 Usage

### 1. Start X11 Virtual Display

```bash
./scripts/start-x11.sh
```

This will:

- Start Xvfb on display :99
- Start D-Bus session
- Test the display
- Show usage instructions

### 2. Test Electron

```bash
./scripts/test-electron.sh
```

This will:

- Verify X11 display is working
- Test Electron version
- Compile the Electron app
- Confirm everything is ready

### 3. Run the Application

```bash
export DISPLAY=:99
pnpm start
```

## 🔧 Environment Variables

- `DISPLAY=:99` - Sets the X11 display to use
- `DBUS_SESSION_BUS_ADDRESS` - D-Bus session address

## 🛠️ Troubleshooting

### X11 Display Not Available

```bash
# Check if Xvfb is running
ps aux | grep Xvfb

# Restart X11
pkill Xvfb
./scripts/start-x11.sh
```

### Electron Still Fails

```bash
# Check display info
xdpyinfo -display :99

# Check D-Bus
echo $DBUS_SESSION_BUS_ADDRESS
```

## 📝 Notes

- The virtual display runs at 1024x768x24 resolution
- X11 server runs in the background
- Use `kill $XVFB_PID` to stop the display server
- This setup is primarily for development/testing in headless environments

## 🎉 Success Indicators

When everything is working correctly, you should see:

- ✅ X11 display is working
- ✅ X11 display is available
- Electron version displayed
- Webpack compilation successful
- Application launches without display errors
