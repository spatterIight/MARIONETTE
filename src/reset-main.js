// Dependencies
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { Webhook, MessageBuilder } = require("discord-webhook-node");
const fs = require("fs"), ini = require("ini");
const { convertCSVToArray } = require("convert-csv-to-array");
const { getHWID } = require('hwid');
const fetch = require("node-fetch");
const prompt = require('prompt-sync')();
var convertTime = require('convert-time');
var inquirer = require('inquirer');
require('events').EventEmitter.defaultMaxListeners = 0;
puppeteer.use(StealthPlugin());
puppeteer.use(require('puppeteer-extra-plugin-block-resources')({
  blockedTypes: new Set(['image'])
}))

// Variables
const parsedConfig = parseConfig()[0];
const discordWebhook = new Webhook(parsedConfig.userinfo.webhook);

let systemHWID = "n/a";
const hwidFunction = (hwid) => { systemHWID = hwid; }
getHWID().then(hwid => { hwidFunction(hwid); })

/*
   -----------------------
   -----------------------
*/

console.log("                     _    _____           _       _    ");
console.log("                    | |  / ____|         (_)     | |   ");
console.log("  _ __ ___  ___  ___| |_| (___   ___ _ __ _ _ __ | |_  ");
console.log(" | '__/ _ \\/ __|/ _ \\ __|\\___ \\ / __| '__| | '_ \\| __| ");
console.log(" | | |  __/\\__ \\  __/ |_ ____) | (__| |  | | |_) | |_  ");
console.log(" |_|  \\___||___/\\___|\\__|_____/ \\___|_|  |_| .__/ \\__| ");
console.log("                                           | |         ");
console.log("                                           |_|         ");

mainMenu();

async function mainMenu() {
  const prompt = await getPrompt();
  inquirer.prompt([{
      type: 'list',
      name: prompt,
      choices: [
        { name: 'Unlock Accounts' },
        { name: 'Monitor Mode' },
        { name: 'Export Accounts' },
        //{ name: 'Account Generator' },
        { name: 'Unbind license' }
      ],
    },
  ])
  .then((answers) => {
    doNext(prompt, answers);
  });
}

async function doNext(query, answers) {
  if (answers[query] == 'Unlock Accounts') {
    if(await validate()) {
      await main();
      prompt('');
      process.exit(1);
    }
  } else if (answers[query] == 'Monitor Mode') {
    if(await validate())
      monitorMode();
  } else if (answers[query] == 'Account Generator') {
    if(await validate())
      await accountGenerator();
      mainMenu();
  } else if (answers[query] == 'Export Accounts') {
    if(await validate()) {
      await exportAccounts();
      mainMenu();
    }
  } else if (answers[query] == 'Unbind license') {
    await resetLicense();
    mainMenu();
  }
}

/*
   -----------------------
   -----------------------
*/

async function main() {
  try {
    const parsedLogins = parseConfig()[1];
    const parsedProxies = parseConfig()[2];
    for (var index = 0; index < parsedLogins.length; index++) {
      let googleEmail = parsedLogins[index][0];
      let googlePassword = parsedLogins[index][1];
      let targetEmail = parsedLogins[index][2];
      let targetPassword = parsedLogins[index][3];
      let proxyAddr = undefined;
      let proxyPort = undefined;
      let proxyUser = undefined;
      let proxyPass = undefined;
      if(parsedLogins[index][4] != null && parsedLogins[index][5] != null) {
        proxyAddr = parsedLogins[index][4];
        proxyPort = parsedLogins[index][5];
        proxyUser = parsedLogins[index][6];
        proxyPass = parsedLogins[index][7];
      } else if (parsedProxies.length > 0) {
        let randProxy = parsedProxies[await getRandomInt(parsedProxies.length)];
        proxyAddr = randProxy[0];
        proxyPort = randProxy[1];
        proxyUser = randProxy[2];
        proxyPass = randProxy[3];
      }
      let ChromeInst = await instantiateChrome(proxyAddr, proxyPort);
      let ChromeInstGmail = await instantiateIncognito(ChromeInst, "https://google.com", proxyUser, proxyPass);
      let ChromeInstTarget = await instantiateIncognito(ChromeInst, "https://target.com", proxyUser, proxyPass);
      if (await navigateTarget(ChromeInstTarget, targetEmail, targetPassword)) {
        if(await googleLogin(ChromeInstGmail, googleEmail, googlePassword)) {
          let resetCode = await parseGmail(ChromeInstGmail, googleEmail, 0, ChromeInstTarget);
          while (!(await inputCode(ChromeInstTarget, resetCode, targetEmail))) {
            resetCode = await parseGmail(ChromeInstGmail, googleEmail, resetCode, ChromeInstTarget);
          }
          await resetPassword(ChromeInstTarget, targetEmail, index);
        }
      }
      await ChromeInstGmail.close();
      await ChromeInstTarget.close();
      await ChromeInst.close();
    }
    return;
  } catch (error) {
    console.log(error.message);
    console.log("main() error --> appending stack to errorLog.txt");
    errorFunction(error);
  }
}

async function monitorMode() {
  try {
    while(true) {
        await main();
        let dateObject = new Date();
        dateObject.setMinutes(dateObject.getMinutes() + parseInt(parsedConfig.userinfo.sleep));
        console.log('Sleeping ' + parsedConfig.userinfo.sleep + ' minutes, until ' + convertTime(dateObject.getHours().toString().slice(-2) + ':' + dateObject.getMinutes().toString().slice(-2)));
        await new Promise((resolve) => setTimeout(resolve, (parsedConfig.userinfo.sleep * 60000)));
    }
  } catch (error) {
    console.log(error.message);
    console.log("monitorMode() error --> appending stack to errorLog.txt");
    errorFunction(error);
  }
}

/*
   -----------------------
   -----------------------
*/

//Functions - Misc
function parseConfig() {
  try {
    const configFile = fs.readFileSync("./config.ini", "utf-8");
    const parsedConfig = ini.parse(configFile);
    const unparsedLogins = Object.keys(parsedConfig.logins);
    const unparsedProxies = Object.keys(parsedConfig.proxies);
    const parsedLogins = [];
    const parsedProxies = [];
    // 2 = No Proxy
    // 3 = IP Auth Proxy
    // 5 = user:pass Proxy
    for (var i = 0; i < unparsedLogins.length; i++) {
      parsedLogins.push(convertCSVToArray(convertCSVToArray(unparsedLogins[i], { separator: "-" })[0][0],{ separator: ":" })[0].concat(convertCSVToArray(convertCSVToArray(unparsedLogins[i], { separator: "-" })[0][1],{ separator: ":" })[0]));
      if(((unparsedLogins[i].match(/:/g)||[]).length) > 2) {
        parsedLogins[i] = parsedLogins[i].concat(convertCSVToArray(convertCSVToArray(unparsedLogins[i], { separator: "-" })[0][2], { separator: ":" })[0]);
      }
    }
    for (var i = 0; i < unparsedProxies.length; i++) {
      parsedProxies.push(convertCSVToArray(unparsedProxies[i], { separator: ":" })[0]);
    }
    return [parsedConfig, parsedLogins, parsedProxies];
  } catch (error) {
    console.log(error.message);
    console.log("parseConfig() error --> appending stack to errorLog.txt");
    errorFunction(error);
  }
}

async function validate() {
  try {
    const license = await retrieveLicense();
    if(license.metadata.hwid) {
      if(license.metadata.hwid == systemHWID) {
        return true;
      } else {
        throw new Error('License is bound to a different machine')
      }
    } else {
      await updateLicense();
      return true;
    }
  } catch (error) {
    console.log(error.message);
    console.log("validate() error --> appending stack to errorLog.txt");
    errorFunction(error);
  }
}

async function accountGenerator(count) {
  try {
    const parsedProxies = parseConfig()[2];
    for(var i = 0; i < count; i++) {
      let accountInfo = accountInfo();
      let randProxy = parsedGen[await getRandomInt(parsedGen.length)];
      let proxyAddr = randProxy[0];
      let proxyPort = randProxy[1];
      let proxyUser = randProxy[2];
      let proxyPass = randProxy[3];
      let ChromeInst = await instantiateChrome(proxyAddr, proxyPort);
      let ChromeInstTarget = await instantiateIncognito(ChromeInst, "https://target.com", proxyUser, proxyPass);
      const PageInst = await ChromeInstTarget.pages();
      await PageInst[0].waitForSelector("#account > span.styles__AccountName-sc-1kk0q5l-0.iQFCAn");
      await PageInst[0].click("#account > span.styles__AccountName-sc-1kk0q5l-0.iQFCAn");
      await new Promise((resolve) => setTimeout(resolve, 500)); /* TO-DO */
      await PageInst[0].click('#accountNav-createAccount > a > div');
      await PageInst[0].waitForSelector('#username');
      await PageInst[0].type("#username", accountInfo[0], { delay: 50 });
      await PageInst[0].type("#firstname", accountInfo[1], { delay: 50 });
      await PageInst[0].type("#lastname", accountInfo[2], { delay: 50 });
      await PageInst[0].type("#password", await generatePassword(), { delay: 50 });
      await PageInst[0].click('#createAccount');
      await addLogin(accountInfo);
      await ChromeInstTarget.close();
      await ChromeInst.close();
    }
  } catch (error) {
    console.log(error.message);
    console.log("accountGenerator() error --> appending stack to errorLog.txt");
    errorFunction(error);
  }
}

async function updateLogin(newPassword, index) {
  try {
    const configFile = fs.readFileSync("./config.ini", "utf-8");
    const parsedLogins = parseConfig()[1];
    const oldLogin = parsedLogins[index][0] + ":" + parsedLogins[index][1] + '-' + parsedLogins[index][2] + ":" + parsedLogins[index][3];
    const newLogin = parsedLogins[index][0] + ":" + parsedLogins[index][1] + '-' + parsedLogins[index][2] + ":" + newPassword;
    fs.writeFileSync("./config.ini", configFile.replace(oldLogin, newLogin), "utf-8");
  } catch (error) {
    console.log(error.message);
    console.log("updateLogin() error --> appending stack to errorLog.txt");
    errorFunction(error);
  }
}

async function saveCookie(email, cookie) {
  try {
    const parsedConfig = parseConfig()[0];
    parsedConfig.cookies[email] = cookie;
    fs.writeFileSync('./config.ini', ini.stringify(parsedConfig, {whitespace: true}).replace(/ = true/g, ''));
  } catch (error) {
    console.log(error.message);
    console.log("saveCookie() error --> appending stack to errorLog.txt");
    errorFunction(error);
  }
}

async function exportAccounts() {
try {
    const parsedLogins = parseConfig()[1];
    let accountsToCSV = 'Site;Username;Password' + '\n';
    for (var index = 0; index < parsedLogins.length; index++) {
      accountsToCSV = accountsToCSV + 'Target;' + parsedLogins[index][2] + ';' + parsedLogins[index][3] + '\n';
    }
    fs.writeFileSync("./exports.csv", accountsToCSV, "utf-8");
  } catch (error) {
    console.log(error.message);
    console.log("exportAccounts() error --> appending stack to errorLog.txt");
    errorFunction(error);
  }
}

async function sendWebhook(targetEmail, newPassword) {
  const embed = new MessageBuilder()
  .addField("Email", "||" + targetEmail + "||", true)
  .addField("Password", "||" + newPassword + "||", true)
  .setColor("#d2738a")
  .setTitle("Account successfully unlocked!")
  discordWebhook.setUsername("resetScript");
  discordWebhook.send(embed);
}

async function errorFunction(error) {
  fs.appendFileSync('errorLog.txt', (error.stack + "\n"));
  prompt('');
  process.exit(1);
}

/*
   -----------------------
   -----------------------
*/

// Functions - Chrome
async function instantiateChrome(proxyAddr, proxyPort) {
  try {
    //let chromeArgs = ['--window-position=99999,99999'];
    if(proxyAddr != null && proxyPort != null) {
      //chromeArgs = ['--window-position=99999,99999', '--proxy-server=' + proxyAddr + ':' + proxyPort + ''];
    }
    const ChromeInst = await puppeteer.launch({
      executablePath: parsedConfig.userinfo.chromePath,
      //args: chromeArgs,
      headless: false,
      ignoreHTTPSErrors: true
    })
    return ChromeInst;
  } catch (error) {
    console.log(error.message);
    console.log("instantiateChrome() error --> appending stack to errorLog.txt");
    errorFunction(error);
  }
}

async function instantiateIncognito(ChromeInst, site, proxyUser, proxyPass) {
  try {
    const ChromeInstIncognito = await ChromeInst.createIncognitoBrowserContext();
    const PageInst = await ChromeInstIncognito.newPage(); 
    if(proxyUser != null && proxyPass != null) {
    await PageInst.authenticate({
      username: '' + proxyUser + '',
      password: '' + proxyPass + '',
      });
    }
    if(site == 'https://google.com') {
      PageInst.setUserAgent("Chrome");
      //PageInst.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0 Safari/605.1.15');
    }
    await PageInst.goto("" + site + "", {
      waitUntil: "networkidle2",
    });
    return ChromeInstIncognito;
  } catch (error) {
    console.log(error.message);
    console.log("instantiateIncognito() error --> appending stack to errorLog.txt");
    errorFunction(error);
  }
}

async function googleLogin(ChromeInstGmail, googleEmail, googlePassword) {
  try {
    const PageInst = await ChromeInstGmail.pages();
    if(parsedConfig.cookies[googleEmail] != null) {
      for(var i = 0; i < parsedConfig.cookies[googleEmail].length; i++) {
        await PageInst[0].setCookie(JSON.parse(parsedConfig.cookies[googleEmail][i]));
      }
      await PageInst[0].reload({ waitUntil: ["networkidle2"] });
      if ((await PageInst[0].$("#guser > nobr > b")) !== null) {
        await Promise.all([
          PageInst[0].waitForNavigation({ waitUntil: "load" }),
          await PageInst[0].click("#gbar > nobr > a:nth-child(7)"),
        ]);
        console.log(googleEmail + " : Logged into Gmail successfully");
        return true;
      } else {
        console.log(googleEmail + " : Cookie error -- logging in manually");
      }
    }
    await Promise.all([
      PageInst[0].waitForNavigation({ waitUntil: "load" }),
      await PageInst[0].click("#gb_70"),
    ]);
    await PageInst[0].waitForSelector('#Email');
    await PageInst[0].type("#Email", googleEmail, { delay: 50 });
    await PageInst[0].click("#next")
    await PageInst[0].waitForSelector('#password');
    await PageInst[0].type("#password", googlePassword, { delay: 50 });
    await PageInst[0].click("#submit");
    await PageInst[0].waitForSelector("#passwordError, #challenge > span > div > div > div.EGmPD, #gbar > nobr > a:nth-child(7)");
    if ((await PageInst[0].$("#passwordError")) !== null) {
      console.log(googleEmail + " : Google account password is incorrect");
      return false;
    }
    if ((await PageInst[0].$("#challenge > span > div > div > div.EGmPD")) !== null) {
      console.log(googleEmail + " : Google account has 2-Step Verification");
      return false;
    }
    await Promise.all([
      PageInst[0].waitForNavigation({ waitUntil: "load" }),
      await PageInst[0].click("#gbar > nobr > a:nth-child(7)"),
    ]);
    console.log(googleEmail + " : Logged into Gmail successfully");
    await saveCookie(googleEmail, await PageInst[0].cookies());
    return true;
  } catch (error) {
    console.log(error.message);
    console.log("googleLogin() error --> appending stack to errorLog.txt");
    errorFunction(error);
  }
}

async function parseGmail(ChromeInstGmail, googleEmail, invalidResetCode, ChromeInstTarget) {
  try {
    const PageInst = await ChromeInstGmail.pages();
    let resetCode = 000000;
    let timeout = 0;
    console.log(googleEmail + " : Attempting to grab reset code");
    while (resetCode == 000000 || resetCode == invalidResetCode) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await PageInst[0].reload({ waitUntil: "networkidle2" });
      await PageInst[0].evaluate("let tempArray = document.querySelectorAll('tbody > tr[bgColor=\"#ffffff\"]')");
      let emailCount = await PageInst[0].evaluate("tempArray.length");
      for (var i = 0; i < emailCount; i++) {
        if ((await PageInst[0].evaluate("tempArray[" + i + "].innerText")).includes("password reset code")) {
          let codeLocationInitial = await PageInst[0].evaluate("tempArray[" + i + '].innerText.search("password reset code")');
          let codeLocationStart = codeLocationInitial + 23;
          let codeLocationEnd = codeLocationInitial + 23 + 6;
          resetCode = await PageInst[0].evaluate("tempArray[" + i + "].innerText.slice(" + codeLocationStart + "," + codeLocationEnd + ")");
          if(resetCode != 000000 && resetCode != invalidResetCode)
            console.log(googleEmail + " : " + "Reset code found --> " + resetCode);
          break;
        }
      }
      timeout = timeout + 1000;
      if(timeout >= 180000) {
        console.log(googleEmail + " : " + "Code timeout, requesting re-send");
        await resendCode(ChromeInstTarget);
        timeout = 0;
      }
    }
    return resetCode;
  } catch (error) {
    console.log(error.message);
    console.log("googleLogin() error --> appending stack to errorLog.txt");
    errorFunction(error);
  }
}

async function resendCode(ChromeInstTarget) {
  const PageInst = await ChromeInstTarget.pages();
  await PageInst[0].click("#showResendMessageLink");
  await new Promise((resolve) => setTimeout(resolve, 100));
  await PageInst[0].click("#resendCodeLink");
  await PageInst[0].click("#root > div > div.styles__AuthContainerWrapper-sc-1eq9g2f-1.drifUu > div > div.sc-kGXeez.teari > div > div > form > input", { clickCount: 3 });
}

async function navigateTarget(ChromeInstTarget, targetEmail, targetPassword) {
  try {
    const PageInst = await ChromeInstTarget.pages();
    await PageInst[0].waitForSelector("#account > span.styles__AccountName-sc-1kk0q5l-0.iQFCAn");
    await PageInst[0].click("#account > span.styles__AccountName-sc-1kk0q5l-0.iQFCAn");
    await new Promise((resolve) => setTimeout(resolve, 500)); /* TO-DO */
    await PageInst[0].click("#accountNav-signIn > a > div");
    await PageInst[0].waitForSelector("#username");
    await PageInst[0].type("#username", targetEmail, { delay: 50 });
    await PageInst[0].type("#password", targetPassword, { delay: 50 });
    await PageInst[0].click("#login");
    await PageInst[0].waitForSelector("#account > span.styles__AccountName-sc-1kk0q5l-0.iQFCAn, #root > div > div.styles__AuthContainerWrapper-sc-1eq9g2f-1.drifUu > div > div.sc-eXEjpC.iTzemA > div");
    return await loginStatus(ChromeInstTarget, targetEmail, 1);
  } catch (error) {
    console.log(error.message);
    console.log("navigateTarget() error --> appending stack to errorLog.txt");
    errorFunction(error);
  }
}

async function loginStatus(ChromeInstTarget, targetEmail, loginAttempt) {
  try {
    const PageInst = await ChromeInstTarget.pages();
    if ((await PageInst[0].$("#root > div > div.styles__AuthContainerWrapper-sc-1eq9g2f-1.drifUu > div > div.sc-eXEjpC.iTzemA > div")) !== null) {
      const accountStatus = await PageInst[0].evaluate(`(() => { return document.querySelector('#root > div > div.styles__AuthContainerWrapper-sc-1eq9g2f-1.drifUu > div > div.sc-eXEjpC.iTzemA > div').innerText; })()`);
      if (accountStatus == "Your account is locked. Please click on forgot password link to reset.") {
        console.log(targetEmail + " : Account locked");
        await PageInst[0].click("#recoveryPassword");
        await PageInst[0].waitForSelector("#continue");
        await PageInst[0].click("#continue");
        //wait a moment for the code to be sent, otherwise needless code invalid
        await new Promise((resolve) => setTimeout(resolve, 2000));
        //#root > div > div.styles__AuthContainerWrapper-sc-1eq9g2f-1.drifUu > div > form > div.sc-kjoXOD.fxsUxV
        //check if send code didnt error
        //put await in front of clicks
        return true;
      } else if (accountStatus == "That password is incorrect.") {
        console.log(targetEmail + " : Target account password is incorrect");
        return false;
      } else if (accountStatus == "Sorry, something went wrong. Please try again.") {
        console.log(targetEmail + " : Sign-in error. Retrying " + (10 - loginAttempt) + " more times");
        if (loginAttempt < 10) {
          await PageInst[0].click("#login");
          await new Promise((resolve) => setTimeout(resolve, 2000));
          await PageInst[0].waitForSelector("#account > span.styles__AccountName-sc-1kk0q5l-0.iQFCAn, #root > div > div.styles__AuthContainerWrapper-sc-1eq9g2f-1.drifUu > div > div.sc-eXEjpC.iTzemA > div");
          return await loginStatus(ChromeInstTarget, targetEmail, loginAttempt + 1);
        } else {
          console.log(targetEmail + " : Sign-in error. Max retry attempt reached, giving up");
          return false;
        }
      } else {
        console.log(targetEmail + " : Unknown login status --> " + accountStatus);
        return false;
      }
    } else if ((await PageInst[0].$("#account > span.styles__AccountName-sc-1kk0q5l-0.iQFCAn")) !== null) {
      console.log(targetEmail + " : Account is already unlocked");
      return false;
    } else {
      console.log(targetEmail + " : Error evaluating unlock/lock status (most likely unlocked)");
      return false;
    }
  } catch (error) {
    console.log(error.message);
    console.log("loginStatus() error --> appending stack to errorLog.txt");
    errorFunction(error);
  }
}

async function inputCode(ChromeInstTarget, resetCode, targetEmail) {
  try {
    const PageInst = await ChromeInstTarget.pages();
    await PageInst[0].waitForSelector("#root > div > div.styles__AuthContainerWrapper-sc-1eq9g2f-1.drifUu > div > div.sc-kGXeez.teari > div > div > form > input");
    await PageInst[0].type("#root > div > div.styles__AuthContainerWrapper-sc-1eq9g2f-1.drifUu > div > div.sc-kGXeez.teari > div > div > form > input", resetCode, { delay: 50 });
    await PageInst[0].click("#verify");
    await new Promise((resolve) => setTimeout(resolve, 2000)); /* if code is invalid, gotta wait for status to update */
    await PageInst[0].waitForSelector("#password, #root > div > div.styles__AuthContainerWrapper-sc-1eq9g2f-1.drifUu > div > div.sc-kGXeez.teari > div > div > div.sc-kjoXOD.fxsUxV");
    return await inputStatus(ChromeInstTarget, targetEmail, 1);
  } catch (error) {
    console.log(error.message);
    console.log("inputCode() error --> appending stack to errorLog.txt");
    errorFunction(error);
  }
}

async function inputStatus(ChromeInstTarget, targetEmail, submitAttempt) {
  try {
    const PageInst = await ChromeInstTarget.pages();
    if ((await PageInst[0].$("#root > div > div.styles__AuthContainerWrapper-sc-1eq9g2f-1.drifUu > div > div.sc-kGXeez.teari > div > div > div.sc-kjoXOD.fxsUxV")) !== null) {
      const codeStatus = await PageInst[0].evaluate(`(() => { return document.querySelector('#root > div > div.styles__AuthContainerWrapper-sc-1eq9g2f-1.drifUu > div > div.sc-kGXeez.teari > div > div > div.sc-kjoXOD.fxsUxV').innerText; })()`);
      if (codeStatus == "That code is invalid.") {
        console.log(targetEmail + " : Code is invalid. Re-checking Gmail");
        await PageInst[0].click("#root > div > div.styles__AuthContainerWrapper-sc-1eq9g2f-1.drifUu > div > div.sc-kGXeez.teari > div > div > form > input", { clickCount: 3 });
        return false;
      } else if (codeStatus == "Sorry, there have been too many unsuccessful verification attempts. Please try again after 5 minutes.") {
        console.log(targetEmail + " : Code input on cooldown --> sleeping 5 minutes before retry");
        await new Promise((resolve) => setTimeout(resolve, 330000)); /* doesnt seem to work, code is expired after 5 minutes */
        await PageInst[0].click("#root > div > div.styles__AuthContainerWrapper-sc-1eq9g2f-1.drifUu > div > div.sc-kGXeez.teari > div > div > form > input", { clickCount: 3 });
        return false; /* make recursive */
      } else if (codeStatus == "Sorry, something went wrong. Please try again.") {
        console.log(targetEmail + " : Code submission error. Retrying " + (10 - submitAttempt) + " more times");
        if (submitAttempt < 10) {
          await PageInst[0].click("#verify");
          await new Promise((resolve) => setTimeout(resolve, 2000));
          await PageInst[0].waitForSelector("#password, #root > div > div.styles__AuthContainerWrapper-sc-1eq9g2f-1.drifUu > div > div.sc-kGXeez.teari > div > div > div.sc-kjoXOD.fxsUxV");
          return await inputStatus(ChromeInstTarget, targetEmail, submitAttempt + 1);
        } else {
          console.log(targetEmail + " : Code submission error. Max retry attempt reached, giving up");
          return false;
        }
      } else {
        console.log(targetEmail + " : Unknown code status --> " + codeStatus);
        return false;
      }
    } else if ((await PageInst[0].$("#password")) !== null) {
      console.log(targetEmail + " : Code accepted. Resetting password");
      return true;
    } else {
      console.log(targetEmail + " : Error evaluating code status");
      return false;
    }
  } catch (error) {
    console.log(error.message);
    console.log("codeStatus() error --> appending stack to errorLog.txt");
    errorFunction(error);
  }
}

async function resetPassword(ChromeInstTarget, targetEmail, index) {
  try {
    const PageInst = await ChromeInstTarget.pages();
    const newPassword = await generatePassword();
    await PageInst[0].type("#password", newPassword, { delay: 50 });
    await Promise.all([
      PageInst[0].waitForNavigation({ waitUntil: "load" }),
      await PageInst[0].click("#submit"),
    ]);
    console.log(targetEmail + " : Account successfully reset, sending webhook!");
    await sendWebhook(targetEmail, newPassword);
    await updateLogin(newPassword, index)
  } catch (error) {
    console.log(error.message);
    console.log("resetPassword() error --> appending stack to errorLog.txt");
    errorFunction(error);
  }
}

/*
   -----------------------
   -----------------------
*/

//Static Functions
async function retrieveLicense() {
  try {
    const license = await fetch(`https://api.metalabs.io/v4/licenses/${parsedConfig.userinfo.key}`, {
      headers: {
        'Authorization': 'Bearer'
      }
    }).then(res => res.json());
    return license; 
  } catch (error) {
    throw new Error('License not found');
  }
}

async function updateLicense() {
  try {
    const body = {
      'metadata': { 'hwid' : systemHWID }
    };
    await fetch(`https://api.metalabs.io/v4/licenses/${parsedConfig.userinfo.key}`, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    throw new Error('updateLicense() failure');
  }
}

async function resetLicense() {
  try {
    const body = {
      'metadata': { 'hwid' : null }
    };
    await fetch(`https://api.metalabs.io/v4/licenses/${parsedConfig.userinfo.key}`, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    throw new Error('resetLicense() failure');
  }
}

async function generatePassword() {
  const numbers = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return (await generateChar() + await generateChar() + numbers[await getRandomInt(numbers.length)] + await generateChar() + await generateChar() + numbers[await getRandomInt(numbers.length)] + await generateChar() + await generateChar());
}

async function generateChar() {
  const upperCase = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
  const lowerCase = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'];
  const symbols = [upperCase, lowerCase];
  symbolType = symbols[await getRandomInt(symbols.length)];
  return symbolType[await getRandomInt(symbolType.length)];
}

async function getPrompt() {
  const choices = ['What are you hankering for?', 'Pick your poison', 'Set forth your modus operandi'];
  return choices[await getRandomInt(choices.length)];
}

async function getRandomInt(max) {
  return Math.floor(Math.random() * Math.floor(max));
}
