# AURAXP
Social game app based on Aura XP, challenges and AI video scoring

## Project status

This is the **initial project scaffold**: an Expo + React Native + TypeScript
app with navigation between placeholder screens and mock data. Nothing is
connected to a backend yet — no Supabase, no AI scoring API.

## Tech stack

- [Expo](https://expo.dev) (SDK 57) + React Native + TypeScript
- [React Navigation](https://reactnavigation.org) — a root native stack
  hosting a bottom tab navigator plus screens pushed on top of it

## Navigation structure

**Bottom tabs** (always visible): Home · Scan · Profile

**Flow screens** (pushed on top of the tabs): Upload/Capture → ScanResult → Challenge

```
Home → Scan → Upload/Capture → ScanResult → Challenge / Share
```

Tapping **Scan** starts the capture flow; the flow screens are pushed onto
the root stack (with a native back button) rather than living as their own
permanent tabs.

## Folder structure

```
src/
  screens/       # One component per app screen (Home, Scan, Upload, ScanResult, Challenge, Profile)
  components/     # Reusable UI building blocks (buttons, cards, XP bar, screen wrapper)
  navigation/     # React Navigation setup (RootNavigator = stack, MainTabNavigator = bottom tabs)
  services/       # Data-access layer — currently returns mock/placeholder data
  hooks/          # Reusable React hooks (e.g. useCurrentUser, useChallenges)
  types/          # Shared TypeScript types
  theme/          # Colors, spacing, radius and typography tokens
```

## Running the app

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the Expo dev server:

   ```bash
   npm start
   ```

   Then either:
   - Scan the QR code with the **Expo Go** app on your phone (Android/iOS), or
   - Press `a` for an Android emulator, `i` for an iOS simulator (macOS
     only), or `w` to run in a web browser.

   You can also jump straight to a platform with:

   ```bash
   npm run android
   npm run ios
   npm run web
   ```

## Notes

- All data shown in the app (user XP, challenges, scan results) is
  **temporary placeholder data** defined in `src/services/mockData.ts`.
- `src/services/api.ts` is a stub for the future service layer — this is
  where Supabase and the AI video-scoring API will be integrated later.
