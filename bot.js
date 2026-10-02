// Compatibility entrypoint.
// The bot now runs only through server.js in webhook mode.
// Keeping this wrapper prevents an old Render start command from launching
// a second polling process and causing Telegram 409 conflicts.
require("./server.js");
