const fs = require('fs');
const fetch = require('node-fetch');
const URL = require('url');
const jsdom = require('jsdom').JSDOM;
const optparse = require('optparse');
const euristics = require('./euristics.js');
const sys = require('sys');
const path = require('path');
const mkdirp = require('mkdirp');


const rootUrl = 'https://bitcointalk.org/';
const BOARDS_ON_PAGE = 40;
const TOPICS_ON_PAGE = 20;
const DEBUG_DOWNLOAD_BOARD_PAGES = 2;
const pageDownloadPauseMin = 100;
const pageDownloadPauseMax = 1000;
const maximumRetries = 1000;

let fetchRetries = 0;


async function fetchPageWithText(url) {
  return fetch(url).then(async res => {
    if (res.ok && fetchRetries < maximumRetries) {
      const page = await res.text();
      const dom = new jsdom(page);
      if (!dom.window.document) {
        console.log(' no document');
      }
      fetchRetries = 0;

      return {page, document: (new jsdom(page)).window.document};
    } else {
      ++fetchRetries;
      const d = getDelauAmount();
      console.log(`Retry #${fetchRetries}: Not ok respone, delay next download: ${d}`);
      return delay(d).then(() => {
        return fetchPageWithText(url);
      });
    }
  });
}

function getDelauAmount() {
  const d = pageDownloadPauseMax - pageDownloadPauseMin;
  return pageDownloadPauseMin + Math.floor(Math.random() * d);
}

async function delay(time) {
  return new Promise((resolve, reject) => {
    setTimeout(()=>{
      resolve();
    }, time);
  });
}



async function fetchPage(url) {
  const result = await fetchPageWithText(url);
  return result.document;
}

async function getAllBoards(forumRoot) {
  const content = await fetchPage(forumRoot);
  const forumGroups = [...content.querySelectorAll('div#bodyarea>div.tborder>table')];
  const boards = [];
  for (let c = 0; c < forumGroups.length - 1; ++c) {
    const bbs = retrieveBoardsFromGroups(forumGroups[c])
    // console.log('--->', bbs.length);
    boards.push(...bbs);
  }
  return boards;
}

function retrieveBoardsFromGroups(table) {
  const trs = [...table.querySelectorAll('tr')];
  const mainBoards = trs.map(nn => nn.querySelectorAll('td')[1]);
  const childBoards = [];
  for(let i = 0; i < mainBoards.length; ++i) {
    if (!mainBoards[i]) {
      childBoards.push(trs[i].querySelectorAll('td')[0]);
    }
  }
  return [
    ...mainBoards.filter(x=>x).map(parseMainBoardNode), 
    ...childBoards.map(parseChildBoardNode).reduce((l, a) => [...l, ...a], [])
  ]
}

function parseChildBoardNode(node) {
  const as = [...node.querySelectorAll('a')];
  return as.map(a => ({boardName: a.textContent, boardUrl: a.getAttribute('href')})); 
}

function parseMainBoardNode(node) {
  const a = node.querySelector('b>a');
  return {boardName: a.textContent, boardUrl: a.getAttribute('href')}; 
}

async function getAllTopics({boardName, boardUrl}) {
  const firstPageContent = await fetchPage(boardUrl);
  const totalPages = retrieveTotalBoardPages(firstPageContent);
  const topics = getAllTopicsFromBoardPage(firstPageContent);
  for (let i = 1; i < totalPages; ++i) {
    const nextPageUrl = createNextBoardPageUrl(boardUrl, i);
    const nextPageContent = await fetchPageWithText(nextPageUrl);
    const moreTopics = getAllTopicsFromBoardPage(nextPageContent.document);
    topics.push(...moreTopics);
    if (DEBUG_DOWNLOAD_BOARD_PAGES && i >= DEBUG_DOWNLOAD_BOARD_PAGES) {
      break;
    } 
  }
  return topics;
}

function getAllTopicsFromBoardPage(boardContent) {
  const tables = [...boardContent.querySelectorAll('div.tborder>table.bordercolor')];
  const table = tables[tables.length - 1];
  if (!table) {
    console.log(`can't get board content`);
    return [];
  }
  const trs = [...table.querySelectorAll('tr')];
  return trs.splice(1, trs.length-1)
    .map(tr => tr.querySelectorAll('td')[2].querySelectorAll('a')[0])
    .map(a => ({topic: a.textContent, topicRootUrl: a.getAttribute('href')}) ) ;
}

function createNextBoardPageUrl(boardUrl, page) {
  const url = URL.parse(boardUrl);
  const search = url.search;
  const slst = search.split('.');
  const skip = BOARDS_ON_PAGE * page;
  slst[1] = skip;
  
  url.search = `${ slst.join('.') }`;
  return URL.format(url); // '';
}

function createNextTopicPageUrl(topicUrl, page) {
  const url = URL.parse(topicUrl);
  const search = url.search;
  const slst = search.split('.');
  const skip = TOPICS_ON_PAGE * page;
  slst[1] = skip;
  
  url.search = `${ slst.join('.') }`;
  return URL.format(url); // '';

}

function retrieveTotalBoardPages(boardContent) {
  const links = [...boardContent.querySelectorAll('td>a.navPages')]
  if (links.length === 0) {
    return 0;
  }
  const finalPage = parseInt(links[links.length - 1].textContent)
  return finalPage;
}

async function retrieveAllMessages({topic, topicRootUrl}, contentSavier, topicSavier){
  const firstPageContent = await fetchPageWithText(topicRootUrl);
  const totalPages = retrieveTotalTopicPages(firstPageContent.document);
  const messages = getAllMessagesFromTopicPageSafe(topicRootUrl, firstPageContent);
  console.log(`\t\t* Processing Page 1/${totalPages}`);
  topicSavier(topic);
  contentSavier(messages);
  for (let i = 1; i < totalPages; ++i) {
    console.log(`\t\t* Processing Page ${i+1}/${totalPages}`);
    const nextPageUrl = createNextTopicPageUrl(topicRootUrl, i);
    const nextPageContent = await fetchPageWithText(nextPageUrl);
    contentSavier(getAllMessagesFromTopicPageSafe(nextPageUrl, nextPageContent));
  }
  return messages;
}

function getAllMessagesFromTopicPageSafe(url, fetchResult) {
  try {
    return getAllMessagesFromTopicPage(fetchResult.document);
  } catch (e) {
    console.log('---- unexpected page content on forum url' + url);
    console.log('=============== Page content:====================');
    console.log(fetchResult.page);
    console.log('=================================================');
    return [];
  }

}

function getAllMessagesFromTopicPage(topicPage) {
  const rawTables = topicPage.querySelectorAll('form>table');
  if (rawTables.length === 0) {
    throw new Error('Unexpected document content.');
  } 
  const tables = [...rawTables[0]
    .querySelectorAll('tr[class] td.windowbg>table, tr[class] td.windowbg2>table')];
  const messages = tables.map(t => t.querySelectorAll('tr')[0]
                                   .querySelectorAll('td')[1]
                                   .querySelectorAll('div.post')[0]);
  return messages.map(d => {
    [...d.querySelectorAll('div,a')].forEach(n => n.remove()) 
    return d.textContent;
  });

}

function getTopicSavier(queue, filename) {
  return topic => {
    queue.push({filename, message: processEuristics(topic, euristics.topic)});
  }
}

function processEuristics(message, euristics) {
    
  euristics.modification.forEach(eur => {
    message = eur(message);
  });

  return message;
}
function getMessagesSavier(queue, filename) {
  const eurs = euristics.message
  return messages => {
    queue.push(...messages
      .filter(m => eurs.filter.every(eur => eur(m)))
      .map(m => ({filename, message: processEuristics(m, eurs)}))); 
  }

}

function retrieveTotalTopicPages(topicPage) {
  return retrieveTotalBoardPages(topicPage);
}

async function saveToFile(file, content) {
  await ensureFolder(file);
  const isExists = await exists(file);
  const flag = isExists ? 'a' : 'w';
  return new Promise((resolve, reject) => {
    fs.writeFile(file, content, {flag:'a'}, error => {
      if (error) reject(error);
      resolve();
    })
  });
}

async function ensureFolder(f) {
  return new Promise((res, rej) => {
    mkdirp(path.dirname(f), err => {
      if (err) rej(err);
      else res();
    })
  });
}

async function exists(file) {
  return new Promise((resolve, reject) => {
    fs.access(file, fs.constants.W_OK, err => {
      if (err) resolve(false);
      else resolve(true);
    })
  })
}

function parseOptions() {
  const switches = [
      ['-h', '--help', 'Shows help sections'],
      ['-B', '--beginFromBoard NUMBER', 'Start parsing and saving from board number'],
      ['-T', '--beginFromTopic NUMBER', 'Start parsing and saving from topic number'],
      ['-b', '--print-boards', 'print boards and theys` numbers'],
      ['-t', '--print-topics', 'print boards and theys` numbers'],
      ['-o', '--output PATH', 'File to save']
  ];

  const options = {
    output: './'
  };
  // Create a new OptionParser.
  const parser = new optparse.OptionParser(switches);
  parser.on('help', () => {
    options.help = true;
  });
  parser.on('*', (f,v) => {
    options[f] = v;
    if (f === 'print-topics') {
      options[f] = true;
    }
    if (f === 'print-boards') {
      options[f] = true;
    }
  })


  parser.parse(process.argv);

  return options;
}

function printHelp() {
  console.log('Download forum bitcointalk.com, options: ');
  console.log('-h, --help', 'print this mesage');
  console.log('-o, --output', 'folder to save topics, default: ./');
  console.log('-b', '--beginFromBoard NUMBER', 'Start parsing and saving from board number');

}

const messagesQueue = [];
let mustI = null;

async function main() {
  const options = parseOptions();
  if (options.help) {
    printHelp();
    return;
  }

  launchSavior(messagesQueue);

  try {
    const boards = await getAllBoards(rootUrl);

    console.log('boards found', boards.length);
    await recursiveBoards(boards, options);

  }
  catch (e) {
    console.log(e);
  }
  stopSavior();
}

async function recursiveBoards(boards, options) {
  const startWith = options.beginFromBoard - 1 || 0;
  const retriveBoard = async i => {
    if (boards[i]) {
      const boardName = boards[i].boardName;
      console.log(`Processing board #${i+1}/${boards.length}: ${boardName}`);
      const topics = await getAllTopics(boards[i]);
      let fromTopic = 0;
      console.log(i, startWith);
      if (i === startWith) {
        fromTopic = options.beginFromTopic -1 || 0;
      }
      await recursiveTopics(topics, boardName, options, fromTopic);
      await retriveBoard(i + 1);
    }
  }
  console.log(options);
  if (options['print-boards']) {
    printBoards(boards);
  }

  return await retriveBoard(Math.max(0, startWith));
}
function printBoards(boards) {
  for (let i = 0; i < boards.length; ++i) {
    const {boardName} = boards[i];
    console.log(i, boardName);
  }
}

async function recursiveTopics(topics, boardName, options, fromTopic = 0) {
  const retriveTopics = async i => {
    if(topics[i]) {
      console.log(`\tProcessing topic #${i+1}/${topics.length}: ${topics[i].topic}`);
      const messageFilename = fileName(options, 'messages', boardName, 'txt');
      const topicFilename = fileName(options, 'topics', boardName, 'txt')
      try {
        await retrieveAllMessages(topics[i], getMessagesSavier(messagesQueue, messageFilename), getTopicSavier(messagesQueue, topicFilename));
      } catch (e) {
        console.log('\n\t\t\t******* WARNING ********\n\n');
        console.log(`\t\t\tTopic "${topics[i].topic}" in board ${boardName} \n`);
        console.log(`\t\t\tin board ${boardName} has error on downloading.\n`);
        console.log(`Actual error was: ${e}`);
        console.log('\n\t\t\t************************\n\n');
      }
      await retriveTopics(i + 1);
    }
  }
  return await retriveTopics(fromTopic);
}

function fileName(options, where, name, ext) {
  return path.join(options.output, where, name) + '.' + ext;
}

function launchSavior(messagesQueue) {
  const saver = async () => {
    if(messagesQueue.length > 0) {
      const localCopy = messagesQueue.splice(0, messagesQueue.length);
      for (let i = 0; i < localCopy.length; ++i) {
        const {filename, message} = localCopy[i];
        await saveToFile(filename, message);
      }
    }
    go();
  }
  mustI = true;
  function go() {
    if (mustI) {
      setTimeout(saver, 10);
    }
  }
  go();
}

function stopSavior() {
  mustI = false;
}


main();


