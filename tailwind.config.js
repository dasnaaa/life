/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  // Die App hat bewusst ein festes dunkles Theme (kein Light-Mode
  // implementiert) statt dem System-Farbschema zu folgen. "class" statt dem
  // NativeWind-Standard "media" vermeidet ausserdem einen bekannten
  // Web-Dev-Timing-Fehler (react-native-css-interop wirft bei "media", wenn
  // sein interner MutationObserver versucht, das Farbschema zu setzen).
  darkMode: "class",
  presets: [require("nativewind/preset")],
  theme: {
    extend: {},
  },
  plugins: [],
};
