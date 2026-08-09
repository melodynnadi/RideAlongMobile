module.exports = ({ config }) => ({
  expo: {
    name: "RideAlong",
    slug: "RideAlongMobile",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/ridealonglogo.png",
    scheme: "ridealong",
    userInterfaceStyle: "automatic",
    statusBarStyle: "dark",
    newArchEnabled: true,
    description: "A student-friendly ride-sharing platform. Book rides or drive — one app, your choice.",
    primaryColor: "#E05E1A",
    runtimeVersion: {
      policy: "appVersion",
    },
    updates: {
      url: "https://u.expo.dev/291e6c2d-b949-4105-9b9e-afed7c864810",
    },
    notification: {
      icon: "./assets/ridealonglogo.png",
      color: "#E05E1A",
    },
    splash: {
      backgroundColor: "#FBFAF7",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.ridealong.mobile",
      statusBarStyle: "dark",
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
      entitlements: {
        "com.apple.developer.in-app-payments": [
          "merchant.com.ridealong.app",
        ],
      },
      associatedDomains: [
        "applinks:ridealongapp.com",
      ],
      config: {
        // Native Google Maps SDK key for iOS — required for MapView(PROVIDER_GOOGLE)
        // to render in standalone/EAS builds (TestFlight, App Store). Expo Go doesn't
        // need this since it uses its own pre-built maps setup, which is why maps
        // work there but render blank in TestFlight without this. Reuses the same
        // key already used for JS-level Places/Directions calls — if this key is
        // restricted in Google Cloud Console to specific apps, make sure the iOS
        // bundle ID "com.ridealong.mobile" is included in its allowed apps list
        // (this is a separate restriction from whatever allows the Android package).
        googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#0B1220",
      },
      statusBarStyle: "dark",
      notification: {
        icon: "./assets/ridealonglogo.png",
        color: "#E05E1A",
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      config: {
        googleMaps: {
          apiKey: "AIzaSyDWOpCIVn_oPxn4qWYE4eG3teKtn0c5G-w",
        },
      },
      permissions: [
        "android.permission.RECORD_AUDIO",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_FINE_LOCATION",
      ],
      package: "com.ridealong.mobile",
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [
            {
              scheme: "https",
              host: "ridealongapp.com",
              pathPrefix: "/ride",
            },
          ],
          category: [
            "BROWSABLE",
            "DEFAULT",
          ],
        },
      ],
    },
    web: {
      bundler: "metro",
      output: "static",
      favicon: "./assets/favicon.png",
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          backgroundColor: "#FBFAF7",
          dark: {
            backgroundColor: "#FBFAF7",
          },
        },
      ],
      [
        "expo-image-picker",
        {
          photosPermission: "This app needs access to your photo library to update your profile picture.",
          cameraPermission: "This app needs access to your camera to take a profile photo.",
        },
      ],
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission: "RideAlong needs your location to match you with nearby rides.",
          locationWhenInUsePermission: "RideAlong needs your location to match you with nearby rides.",
        },
      ],
      "expo-font",
      "expo-web-browser",
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      router: {},
      eas: {
        projectId: "291e6c2d-b949-4105-9b9e-afed7c864810",
      },
    },
    owner: "melody_nnadi",
  },
});
