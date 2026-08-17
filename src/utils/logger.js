// libsignal (dependency de baileys) tem um `console.info("Closing session:", session)`
// hardcoded em session_record.js que solta ~40 linhas de dump por sessão Signal fechada.
// Como não usamos console.info em nenhum lugar do código, filtramos essa mensagem
// específica no bootstrap. Import lateral com efeito colateral — basta importar este
// módulo cedo (src/index.js) pra ativar.
const origConsoleInfo = console.info.bind(console);
console.info = (...args) => {
  const first = args[0];
  if (typeof first === "string" && first.startsWith("Closing session:")) return;
  origConsoleInfo(...args);
};

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const currentLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function fmt(level, mod, msg) {
  return `[${mod}] ${level} ${msg}`;
}

export function createLogger(mod) {
  return {
    debug(msg, ...args) {
      if (currentLevel <= LEVELS.debug) console.log(fmt("DEBUG", mod, msg), ...args);
    },
    info(msg, ...args) {
      if (currentLevel <= LEVELS.info) console.log(fmt("INFO", mod, msg), ...args);
    },
    warn(msg, ...args) {
      if (currentLevel <= LEVELS.warn) console.warn(fmt("WARN", mod, msg), ...args);
    },
    error(msg, ...args) {
      if (currentLevel <= LEVELS.error) console.error(fmt("ERROR", mod, msg), ...args);
    },
  };
}
