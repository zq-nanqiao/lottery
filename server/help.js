const fs = require("fs");
const path = require("path");
const xlsx = require("node-xlsx").default;
let cwd = path.join(__dirname, "cache");

if (!fs.existsSync(cwd)) {
  fs.mkdirSync(cwd);
}

/**
 * 读取缓存的数据内容
 */
function loadTempData() {
  let pros = [];
  pros.push(
    new Promise((resolve, reject) => {
      fs.readFile(path.join(cwd, "temp.json"), "utf8", (err, data) => {
        if (err) {
          resolve({});
          return;
        }
        resolve(JSON.parse(data));
      });
    })
  );

  pros.push(
    new Promise((resolve, reject) => {
      fs.readFile(path.join(cwd, "error.json"), "utf8", (err, data) => {
        if (err) {
          resolve([]);
          return;
        }
        resolve(JSON.parse(data));
      });
    })
  );

  return Promise.all(pros);
}

/**
 * 读取XML文件数据
 */
function loadXML(xmlPath) {
  let userData = xlsx.parse(xmlPath);
  let outData = [];
  userData.forEach(item => {
    outData = item.data;
    outData.shift();
    return false;
  });
  outData = outData.filter(item => item.length > 0);
  return outData;
}

/**
 * 写入excel
 * @param {Array} data
 * @param {string} name
 */
function writeXML(data, name) {
  let buffer = xlsx.build([
    {
      name: "抽奖结果",
      data: data
    }
  ]);

  return new Promise((resolve, reject) => {
    fs.writeFile(path.join(process.cwd(), name), buffer, err => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

/**
 * 写入文件
 * @param {*} data
 */
function saveDataFile(data) {
  data = JSON.stringify(data, "", 2);

  if (!fs.existsSync(cwd)) {
    fs.mkdirSync(cwd);
  }

  return new Promise((resolve, reject) => {
    fs.writeFile(path.join(cwd, "temp.json"), data, err => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
      console.log("数据写入成功");
    });
  });
}

/**
 * 错误日志文件输出
 * @param {*} data
 */
function saveErrorDataFile(data) {
  data = JSON.stringify(data, "", 2);
  if (!fs.existsSync(cwd)) {
    fs.mkdirSync(cwd);
  }

  return new Promise((resolve, reject) => {
    fs.writeFile(path.join(cwd, "error.json"), data, err => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
      console.log("数据写入成功");
    });
  });
}

/**
 * 洗牌算法
 * @param {*} arr
 */
function shuffle(arr) {
  let i = arr.length;
  while (i) {
    let j = Math.floor(Math.random() * i--);
    let temp = arr[j];
    arr[j] = arr[i];
    arr[i] = temp;
  }
}

/**
 * 保存签到数据
 * @param {Map} data
 */
function saveCheckinData(data) {
  let obj = Array.from(data.entries());
  let json = JSON.stringify(obj, "", 2);
  return new Promise((resolve, reject) => {
    fs.writeFile(path.join(cwd, "checkin.json"), json, err => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
      console.log("签到数据写入成功");
    });
  });
}

/**
 * 读取签到数据
 */
function loadCheckinData() {
  return new Promise((resolve, reject) => {
    fs.readFile(path.join(cwd, "checkin.json"), "utf8", (err, data) => {
      if (err) {
        resolve(new Map());
        return;
      }
      try {
        let entries = JSON.parse(data);
        resolve(new Map(entries));
      } catch (e) {
        resolve(new Map());
      }
    });
  });
}

/**
 * 清除签到数据文件
 */
function clearCheckinData() {
  let filePath = path.join(cwd, "checkin.json");
  return new Promise((resolve, reject) => {
    if (fs.existsSync(filePath)) {
      fs.unlink(filePath, err => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
        console.log("签到数据已清除");
      });
    } else {
      resolve();
    }
  });
}

/**
 * 保存抽奖状态
 */
function saveLotteryStatus() {
  return new Promise((resolve, reject) => {
    fs.writeFile(
      path.join(cwd, "lottery_status.json"),
      JSON.stringify({ started: true }),
      err => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
        console.log("抽奖状态已持久化");
      }
    );
  });
}

/**
 * 读取抽奖状态
 */
function loadLotteryStatus() {
  return new Promise((resolve, reject) => {
    fs.readFile(path.join(cwd, "lottery_status.json"), "utf8", (err, data) => {
      if (err) {
        resolve(false);
        return;
      }
      try {
        resolve(JSON.parse(data).started === true);
      } catch (e) {
        resolve(false);
      }
    });
  });
}

/**
 * 清除抽奖状态文件
 */
function clearLotteryStatus() {
  let filePath = path.join(cwd, "lottery_status.json");
  return new Promise((resolve, reject) => {
    if (fs.existsSync(filePath)) {
      fs.unlink(filePath, err => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
        console.log("抽奖状态已清除");
      });
    } else {
      resolve();
    }
  });
}

/**
 * 保存报名状态
 */
function saveRegistrationStatus(open) {
  return new Promise((resolve, reject) => {
    fs.writeFile(
      path.join(cwd, "registration_status.json"),
      JSON.stringify({ open }),
      err => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
        console.log(`报名状态已持久化: ${open ? "开启" : "关闭"}`);
      }
    );
  });
}

/**
 * 读取报名状态
 */
function loadRegistrationStatus() {
  return new Promise((resolve, reject) => {
    fs.readFile(path.join(cwd, "registration_status.json"), "utf8", (err, data) => {
      if (err) {
        resolve(false);
        return;
      }
      try {
        resolve(JSON.parse(data).open === true);
      } catch (e) {
        resolve(false);
      }
    });
  });
}

/**
 * 清除报名状态文件
 */
function clearRegistrationStatus() {
  let filePath = path.join(cwd, "registration_status.json");
  return new Promise((resolve, reject) => {
    if (fs.existsSync(filePath)) {
      fs.unlink(filePath, err => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
        console.log("报名状态已清除");
      });
    } else {
      resolve();
    }
  });
}

module.exports = {
  loadTempData,
  loadXML,
  shuffle,
  writeXML,
  saveDataFile,
  saveErrorDataFile,
  saveCheckinData,
  loadCheckinData,
  clearCheckinData,
  saveLotteryStatus,
  loadLotteryStatus,
  clearLotteryStatus,
  saveRegistrationStatus,
  loadRegistrationStatus,
  clearRegistrationStatus
};
