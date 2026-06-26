const { startServer } = require("./app");

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
