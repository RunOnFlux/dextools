const { supported_resolutions } = require("../helper");

const getConfig = () => {
  return {
    supported_resolutions: supported_resolutions,
    supports_group_request: false,
    supports_marks: false,
    supports_search: true,
    supports_timescale_marks: false,
    symbol_types: [
      {
        name: "Crypto",
        value: "crypto",
      },
    ],
    exchanges: [
      { value: "KADDEX", name: "Kaddex", description: "" },
    ],
  };
};

module.exports = getConfig;