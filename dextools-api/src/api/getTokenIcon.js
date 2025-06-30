const path = require("path");
const fs = require("fs").promises;
const {
  tokenIconsMap,
  extractTokenName,
  tickersIconsMap,
} = require("../helper/tokenMap");

async function getTokenIcon(query) {
  const { token } = query;

  if (!token) {
    throw new Error("Token parameter is required");
  }

  const decodedToken = decodeURIComponent(token);
  console.log("🚀 ~ getTokenIcon ~ decodedToken:", decodedToken);

  let iconFileName = tokenIconsMap[decodedToken];
  console.log("🚀 ~ getTokenIcon ~ iconFileName:", iconFileName);

  if (!iconFileName) {
    iconFileName = tickersIconsMap[decodedToken.toLowerCase()];
    console.log("🚀 ~ getTokenIcon ~ iconFileName:", iconFileName);
  }

  if (!iconFileName) {
    const tokenName = extractTokenName(decodedToken);
    iconFileName = `${tokenName}.png`;
  }

  const iconPath = path.join(
    process.cwd(),
    "public",
    "token-icons",
    iconFileName
  );
  const defaultIconPath = path.join(
    process.cwd(),
    "public",
    "token-icons",
    "default.svg"
  );

  try {
    await fs.access(iconPath);
    return {
      success: true,
      iconUrl: `/public/token-icons/${iconFileName}`,
      iconPath: iconPath,
      token: decodedToken,
    };
  } catch (error) {
    try {
      await fs.access(defaultIconPath);
      return {
        success: true,
        iconUrl: "/public/token-icons/default.svg",
        iconPath: defaultIconPath,
        token: decodedToken,
        fallback: true,
      };
    } catch (defaultError) {
      throw new Error("Default icon not found");
    }
  }
}

module.exports = { getTokenIcon };
