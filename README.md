# Reminder Buddy

A small Windows desktop app. A character (your own photo) pops up at the bottom-right of the screen with a speech bubble and a reminder. Press "Yes, done" or "Later".

## Run it (for testing)

1. Install Node.js (LTS) from nodejs.org
2. Open a terminal in this folder
3. `npm install`
4. `npm start`

## Build the Windows installer

`npm run build` creates a Setup .exe inside the `dist` folder.

## Using it

- On first launch the bundled characters are added automatically (standing, and holding a water bottle for the water reminder). Open Settings from the tray icon to set your name and reminders.
- Click **Add photo or video**. A photo is turned into a doodle (your original photo is not stored). A short video (MP4 or WebM, up to 25 MB) plays in a loop.
- Click the plain background to remove it, adjust the sliders, then **Save character**.
- The character walks in from the left, asks the question in a bubble, and walks away after you press Yes or Remind me later.
- A walking video plays while the character crosses the screen, then it switches to the standing picture. Choose it under **Walking animation** in Settings.
- Add as many characters as you like and click one to select it. Change it any time.
- Edit the reminders: on/off, emoji, message, interval in minutes.
- Use **Save and test reminder** to see the popup right away.
- **Ask Buddy**: press Ctrl+Alt+B (or use the tray menu) and type a command: open youtube, search cats on youtube, close youtube, open documents, clear temp files, empty recycle bin, clean downloads. Anything else (for example `do open notepad and write a shopping list`) is done by Buddy using the mouse and keyboard itself, using your own Anthropic API key (paste it once in the Ask Buddy box; it is stored only on this computer). Stop with Ctrl+Alt+X. Ask Buddy is protected by a PIN (set on first use, locks after 10 idle minutes, when Windows locks, or when you type `lock`); delete actions and PC control ask for the PIN again; the API key is encrypted with Windows secure storage. **Full access** (type `full access on`, PIN needed): Buddy can also run PowerShell commands as you, so it can do file, app and settings work directly. Deleting, stopping the PC, changing settings and downloads ask you first; some commands are always blocked. Turn off with `full access off`. When Ask Buddy finishes, your character walks in and tells you the result in a speech bubble and reads it aloud (type `voice off` to mute the voice). Commands can be typed in English, Tamil or mixed (for example `யூடியூப் ஓபன் பண்ணு`, `youtube open pannu`). Deleting actions always ask first, and files go to the Recycle Bin.
- The tray icon (near the clock) has Ask Buddy, Settings, Test, Pause and Quit.
- The app starts with Windows automatically.

Your photos and settings are stored on your own computer only.

## Get the Setup.exe automatically (GitHub Actions)

1. Create a free GitHub account and a new repository (private is fine).
2. Upload all files from this folder, including the hidden `.github` folder, to the repository.
3. Open the **Actions** tab, choose **Build Windows installer**, and click **Run workflow**.
4. After 3 to 5 minutes, open the finished run and download **Reminder-Buddy-Setup** under Artifacts. Inside is `Reminder Buddy Setup 0.1.0.exe`.
