// The phone's copy of the model code. The phone app is one HTML file with no
// build step, so this is bundled to public/js/nucleus-model.js (a global
// `NucleusModel`) by `npm run build:phone-model`, which runs before every
// hosting deploy. Use it with the compat SDK:
//
//   const store = NucleusModel.namespacedStore(firebase.firestore());
//
// Not loaded by the phone yet.

export * from "./model";
export * from "./store";
export * from "./resolve";
export { fromLegacy, PER_DEVICE } from "./fromLegacy";
export { toLegacy, bridgeEdit, caregiverLegacyState } from "./toLegacy";
export * from "./onboarding";
