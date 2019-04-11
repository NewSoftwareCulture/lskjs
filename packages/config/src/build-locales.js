const fs = require('fs');
const groupBy = require('lodash/groupBy');
const forEach = require('lodash/forEach');
const { getKeyValJson, parseRawJson, parseTxt } = require('./utils');

// const blackListNs = ['events', 'adminTelegram', 'document'];
const locales = ['ru', 'en'];
const rawDir = 'locales-raw' //`${__dirname}/../public/locales`;
const localesDirname = 'locales'
const urls = [
  'locales-raw/lsk.csv'
  'locales-raw/buzzguru-ui.csv'
  'locales-raw/buzzguru-analytics.csv'
]
const files = [
  'locales-raw/lsk.csv',
  'locales-raw/buzzguru-ui.csv',
  'locales-raw/buzzguru-analytics.csv',
]

const localesRows = [];
files.forEach(file => {
  const rows = csvtojson(readFile(file));
  localesRows.push(...rows);
})


try {
  fs.rmdirSync(`${localesDirname}`);
  fs.mkdirSync(`${localesDirname}`);
} catch (err) {}
locales.forEach((locale) => {
  const dirname = `${localesDirname}/${locale}`;
  try {
    fs.mkdirSync(`${dirname}`);
  } catch (err) {}



  fs.writeFileSync(`${dirname}.json`, JSON.stringify(getKeyValJson(localesRows, locale), null, 2)); // eslint-disable-line max-len
  // fs.writeFileSync(`${dirname}/translation.json`, JSON.stringify(getKeyValJson(localesRows, locale), null, 2)); // eslint-disable-line max-len
  const namespaces = groupBy(localesRows, 'ns');
  forEach(namespaces, (rows, ns) => {
    if (!ns) return;
    fs.writeFileSync(`${dirname}/${ns}.json`, JSON.stringify(getKeyValJson(rows, locale), null, 2));
  });
});
