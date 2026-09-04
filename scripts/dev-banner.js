const c = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  green: '\x1b[32m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

console.log('');
console.log(
  `${c.bold}${c.cyan}┌────────────────────────────────────────────────────┐${c.reset}`,
);
console.log(
  `${c.bold}${c.cyan}│  ${c.reset}${c.bold}Compliance Toolkit — dev server             ${c.bold}${c.cyan}│${c.reset}`,
);
console.log(
  `${c.bold}${c.cyan}├────────────────────────────────────────────────────┤${c.reset}`,
);
console.log(
  `${c.bold}${c.cyan}│  ${c.reset}${c.magenta}Web (frontend)${c.reset}   ${c.green}http://localhost:5173${c.reset}   ${c.bold}${c.cyan}│${c.reset}`,
);
console.log(
  `${c.bold}${c.cyan}│  ${c.reset}${c.magenta}API (backend)${c.reset}    ${c.green}http://localhost:4000${c.reset}   ${c.bold}${c.cyan}│${c.reset}`,
);
console.log(
  `${c.bold}${c.cyan}└────────────────────────────────────────────────────┘${c.reset}`,
);
console.log(`${c.dim}  Waiting for services to start...${c.reset}`);
console.log('');
