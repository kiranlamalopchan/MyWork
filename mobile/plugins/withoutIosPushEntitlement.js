const { withEntitlementsPlist } = require("@expo/config-plugins");

/**
 * Personal/free Apple IDs can't sign a provisioning profile that requests
 * the Push Notifications capability, so aps-environment blocks every local
 * iOS device build outright. expo-notifications adds it unconditionally;
 * this strips it back out for a local build. An EAS build (EAS_BUILD is set
 * there) is signed by a paid team and keeps it, so store builds get push.
 */
module.exports = function withoutIosPushEntitlement(config) {
  // Only a build on this laptop; an EAS build has a real team and keeps push.
  if (process.env.EAS_BUILD) return config;
  return withEntitlementsPlist(config, (config) => {
    delete config.modResults["aps-environment"];
    return config;
  });
};
