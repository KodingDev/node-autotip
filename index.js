/* eslint-disable no-underscore-dangle, no-return-assign */
const mineflayer = require('mineflayer');
const config = require('./config');
const login = require('./lib/login');
const logger = require('./lib/logger');
const { tipIncrement, getLifetimeStats } = require('./lib/tracker');
const tipper = require('./lib/tipper');
const util = require('./util/utility');
const Discord = require('discord.js');
const credentials = require('./credentials.json');

const options = {
  host: 'mc.hypixel.net',
  port: 25565,
  version: '1.8.9',
  username: credentials.username,
  password: credentials.password,
};
let bot;
(function init() {
  bot = mineflayer.createBot(options);
  bot._client.once('session', session => options.session = session);
  bot.once('end', () => {
    setTimeout(() => {
      logger.info('Reconnecting...');
      init();
    }, 60000);
  });
}());

const client = new Discord.Client();
let queue = [];

function log(msg) {
  queue.push(msg);
}

setInterval(() => {
  if (!queue.length)
    return;

  const channel = client.channels.get("645914302519181322");
  if (channel) {
    channel.sendMessage(`\`\`\`css\n${queue.join('\n')}\n\`\`\``)
  }

  queue = [];
}, 1000);

function getUUID() {
  return bot._client.session.selectedProfile.id;
}

function sendToLimbo() {
  logger.info('Sending player to limbo...');
  bot.chat('/achat §c');
}

function getHoverData(message) {
  const arr = message.hoverEvent.value.text.split('\n');
  arr.shift();
  return arr;
}

function logRewards(arr = []) {
  if (config.PRINT_REWARDS) {
    arr.forEach((line) => {
      log(line);
      logger.game(util.toANSI(`${line}§r`));
    });
  }
}

function chatLogger(message) {
  const str = message.toString();
  const ansi = message.toAnsi();
  const regex = /You've already tipped someone in the past hour in [\w\s]*! Wait a bit and try again!/;
  const blacklist = [
    'A kick occurred in your connection, so you have been routed to limbo!',
    'Illegal characters in chat',
    'That player is not online, try another user!',
    'No one has a network booster active right now! Try again later.',
    'You already tipped everyone that has boosters active, so there isn\'t anybody to be tipped right now!',
    'You\'ve already tipped someone in the past hour in',
  ];
  if (config.HIDE_TIP_MESSAGES) {
    if (blacklist.includes(str) || regex.test(str)) {
      logger.debug(ansi);
      return;
    }
  }
  if (config.HIDE_JOIN_MESSAGES) {
    if (/^[\w]+ (left|joined).$/.test(str)) {
      logger.debug(ansi);
      return;
    }
  }
  logger.game(ansi);
}

let uuid;
let autotipSession;

bot.on('login', () => {
  uuid = getUUID(bot);
  logger.debug(`Logged on ${options.host}:${options.port}`);
  getLifetimeStats(uuid, (stats) => {
    logger.info(util.toANSI(stats));
  });
  setTimeout(() => {
    const { session } = bot._client;
    sendToLimbo();
    login(uuid, session, (aSession) => {
      autotipSession = aSession;
      tipper.initTipper(bot, autotipSession);
    });
  }, 1000);
});

bot.on('message', (message) => {
  const msg = message.toString();
  log(msg);
  chatLogger(message);
  if (msg.startsWith('You tipped')) {
    const arr = getHoverData(message);
    const tips = (/tipped \w* players in (\d*)/.exec(msg) !== null)
      ? /tipped \w* players in (\d*)/.exec(msg)[1]
      : 1;
    const karma = (tips > 1 && arr.some(line => line.includes('Quakecraft')))
      ? (tips - 5) * config.TIP_KARMA
      : tips * config.TIP_KARMA;
    arr.push(`§d+${karma} Karma`);
    tipIncrement(uuid, { type: 'sent', amount: tips }, arr);
    logRewards(arr);
  }
  if (msg.startsWith('You were tipped')) {
    const arr = getHoverData(message);
    const tips = /by (\d*) players/.exec(msg)[1];
    tipIncrement(uuid, { type: 'received', amount: tips }, arr);
    logRewards(arr);
  }
  if (msg.startsWith('That player is not online, try another user!')
    || msg.startsWith('You\'ve already tipped that person today')) {
    tipper.tipFailed();
  }
});

bot.on('kicked', (reason) => {
  logger.info(`Kicked for ${reason}`);
});

function gracefulShutdown() {
  logger.info('Received kill signal, shutting down gracefully.');
  try {
    autotipSession.logOut(() => {
      logger.info('Closed out remaining connections.');
      process.exit();
    });
  } catch (e) {
    logger.warn('Closing without establishing autotip session.');
    process.exit();
  }

  // if after
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit();
  }, 10 * 1000);
}
// listen for TERM signal .e.g. kill
process.once('SIGTERM', gracefulShutdown);
// listen for INT signal e.g. Ctrl-C
process.once('SIGINT', gracefulShutdown);

client.login(credentials.token);

client.on('message', m => {
  if (m.author.id !== '341841981074309121' || m.channel.id != '645914302519181322')
    return;

  bot.chat(m.content);
});