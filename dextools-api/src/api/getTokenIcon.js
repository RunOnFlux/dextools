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

  let iconFileName = tokenIconsMap[decodedToken];

  if (!iconFileName) {
    iconFileName = tickersIconsMap[decodedToken.toLowerCase()];
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
    "default.png"
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
        iconUrl: "/public/token-icons/default.png",
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
