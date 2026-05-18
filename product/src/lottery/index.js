import "./index.css";
import "../css/animate.min.css";
import "./canvas.js";
import {
  addQipao,
  setPrizes,
  showPrizeList,
  setPrizeData,
  resetPrize,
  defaultType
} from "./prizeList";
import { NUMBER_MATRIX } from "./config.js";
import { io } from "socket.io-client";

const ROTATE_TIME = 3000;
const ROTATE_LOOP = 1000;
const BASE_HEIGHT = 1080;

let TOTAL_CARDS,
  btns = {
    enter: document.querySelector("#enter"),
    lotteryBar: document.querySelector("#lotteryBar"),
    lottery: document.querySelector("#lottery")
  },
  prizes,
  department_prizes=[],//部门最大中奖人数
  EACH_COUNT,
  ROW_COUNT = 7,
  COLUMN_COUNT = 17,
  COMPANY,
  HIGHLIGHT_CELL = [],
  // 当前的比例
  Resolution = 1;

let camera,
  scene,
  renderer,
  controls,
  threeDCards = [],
  targets = {
    table: [],
    sphere: []
  };

let rotateObj;

let selectedCardIndex = [],
  rotate = false,
  basicData = {
    prizes: [], //奖品信息
    users: [], //所有人员
    luckyUsers: {}, //按奖项汇总的已中奖人员
    leftUsers: [], //未中奖人员
    allLuckyUsers:[],//所有已中奖人员
    participants:[]//实际参与抽奖人员
  },
  interval,
  // 当前抽的奖项，从最低奖开始抽，直到抽到大奖
  currentPrizeIndex,
  currentPrize,
  // 正在抽奖
  isLotting = false,
  currentLuckys = [],
  stopTriggered = false,
  socket = null,
  qrDataURL = null,
  connectionInfo = null,
  stateUpdateTimer = null,
  isLotteryStarted = false,
  isRegistrationOpen = false,
  totalUsers = 0,
  recentJoins = [];

initAll();

/**
 * 初始化所有DOM
 */
function initAll() {
  window.AJAX({
    url: "/getTempData",
    success(data) {
      console.log("initAll");
      // 获取基础数据
      prizes = data.cfgData.prizes;
      EACH_COUNT = data.cfgData.EACH_COUNT;
      COMPANY = data.cfgData.COMPANY;
      HIGHLIGHT_CELL = createHighlight();
      basicData.prizes = prizes;
      department_prizes=data.cfgData.department_prizes;
      qrDataURL = data.qrDataURL || null;
      connectionInfo = data.connectionInfo || null;
      totalUsers = data.checkedInCount || data.totalUsers || 0;
      recentJoins = data.recentParticipants || [];
      isLotteryStarted = data.isLotteryStarted || false;
      isRegistrationOpen = data.isRegistrationOpen || false;

      setPrizes(prizes);
      initWebSocket();

      TOTAL_CARDS = ROW_COUNT * COLUMN_COUNT;

      // 读取当前已设置的抽奖结果
      basicData.leftUsers = data.leftUsers;
      basicData.luckyUsers = data.luckyData;


      let prizeIndex = basicData.prizes.length - 1;
      for (; prizeIndex > -1; prizeIndex--) {
        if (data.luckyData[prizeIndex]) {
          basicData.allLuckyUsers= basicData.allLuckyUsers.concat(data.luckyData[prizeIndex]);
        }
      }
      console.log(basicData.allLuckyUsers);
      prizeIndex = basicData.prizes.length - 1;
      for (; prizeIndex > -1; prizeIndex--) {
        if (
          data.luckyData[prizeIndex] &&
          data.luckyData[prizeIndex].length >=
            basicData.prizes[prizeIndex].count
        ) {
          continue;
        }
        currentPrizeIndex = prizeIndex;
        currentPrize = basicData.prizes[currentPrizeIndex];
        break;
      }

      showPrizeList(currentPrizeIndex);
      let curLucks = basicData.luckyUsers[currentPrize.type];
      setPrizeData(currentPrizeIndex, curLucks ? curLucks.length : 0, true);
    }
  });

  window.AJAX({
    url: "/getUsers",
    success(data) {
      basicData.users = data;

      initCards();
      // startMaoPao();
      animate();
      shineCard();
    }
  });
}

function initCards() {
  let member = basicData.users.slice(),
    showCards = [],
    length = member.length;

  let isBold = false,
    index = 0,
    totalMember = member.length,
    position = {
      x: (140 * COLUMN_COUNT - 20) / 2,
      y: (180 * ROW_COUNT - 20) / 2
    };

  camera = new THREE.PerspectiveCamera(
    40,
    window.innerWidth / window.innerHeight,
    1,
    10000
  );
  camera.position.z = 3000;

  scene = new THREE.Scene();

  for (let i = 0; i < ROW_COUNT; i++) {
    for (let j = 0; j < COLUMN_COUNT; j++) {
      isBold = HIGHLIGHT_CELL.includes(j + "-" + i);
      var element = createCard(
        member[index % length],
        isBold,
        index,
        true
      );

      var object = new THREE.CSS3DObject(element);
      object.position.x = Math.random() * 4000 - 2000;
      object.position.y = Math.random() * 4000 - 2000;
      object.position.z = Math.random() * 4000 - 2000;
      scene.add(object);
      threeDCards.push(object);
      //

      var object = new THREE.Object3D();
      object.position.x = j * 140 - position.x;
      object.position.y = -(i * 180) + position.y;
      targets.table.push(object);
      index++;
    }
  }

  // sphere

  var vector = new THREE.Vector3();

  for (var i = 0, l = threeDCards.length; i < l; i++) {
    var phi = Math.acos(-1 + (2 * i) / l);
    var theta = Math.sqrt(l * Math.PI) * phi;
    var object = new THREE.Object3D();
    object.position.setFromSphericalCoords(800 * Resolution, phi, theta);
    vector.copy(object.position).multiplyScalar(2);
    object.lookAt(vector);
    targets.sphere.push(object);
  }

  renderer = new THREE.CSS3DRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById("container").appendChild(renderer.domElement);

  //

  controls = new THREE.TrackballControls(camera, renderer.domElement);
  controls.rotateSpeed = 0.5;
  controls.minDistance = 500;
  controls.maxDistance = 6000;
  controls.addEventListener("change", render);

  bindEvent();

  switchScreen("enter");
}

function setLotteryStatus(status = false) {
  isLotting = status;
}

/**
 * 事件绑定
 */
function bindEvent() {
  document.querySelector("#menu").addEventListener("click", function (e) {
    e.stopPropagation();
    // 如果正在抽奖，则禁止一切操作
    if (isLotting) {
      if (e.target.id === "lottery") {
        stopTriggered = true;
        if (rotateObj && rotateObj.stop) {
          rotateObj.stop();
        }
        scene.rotation.y = 0;
        btns.lottery.innerHTML = "开始抽奖";
        selectWinners();
        selectCard();
        notifyStateChange();
      } else {
        addQipao("正在抽奖，抽慢一点点～～");
      }
      return false;
    }

    let target = e.target.id;
    switch (target) {
      // 显示数字墙
      case "welcome":
        switchScreen("enter");
        rotate = false;
        break;
      // 进入抽奖
      case "enter":
        removeHighlight();
        addQipao(`马上抽取[${currentPrize.title}],不要走开。`);
        // rotate = !rotate;
        rotate = true;
        switchScreen("lottery");
        isLotteryStarted = true;
        if (socket && socket.connected) {
          socket.emit("display:lottery_entered");
        }
        break;
      // 重置
      case "reset":
        showConfirm("是否确认重置数据？\n重置后，当前已抽的奖项全部清空。").then(function(confirmed) {
          if (!confirmed) return;
          addQipao("重置所有数据，重新抽奖");
          addHighlight();
          resetCard();
          // 重置所有数据
          currentLuckys = [];
          basicData.luckyUsers = {};
          basicData.allLuckyUsers=[];
          basicData.participants=[];
          currentPrizeIndex = basicData.prizes.length - 1;
          currentPrize = basicData.prizes[currentPrizeIndex];

          resetPrize(currentPrizeIndex);
          reset();
          totalUsers = 0;
          recentJoins = [];
          isLotteryStarted = false;
          isRegistrationOpen = false;
          window.AJAX({
            url: "/getUsers",
            success(data) {
              basicData.users = data;
              basicData.leftUsers = Object.assign([], data);
            }
          });
          switchScreen("enter");
          if (socket && socket.connected) {
            socket.emit("display:lottery_reset");
          }
        });
        break;
      // 抽奖
      case "lottery":
        setLotteryStatus(true);
        // 每次抽奖前先保存上一次的抽奖数据
        saveData();
        //更新剩余抽奖数目的数据显示
        changePrize();
        resetCard().then(res => {
          // 抽奖
          lottery();
        });
        addQipao(`正在抽取[${currentPrize.title}],调整好姿势`);
        break;
      // 重新抽奖
      case "reLottery":
        if (currentLuckys.length === 0) {
          addQipao(`当前还没有抽奖，无法重新抽取喔~~`);
          return;
        }
        setErrorData(currentLuckys);
        addQipao(`重新抽取[${currentPrize.title}],做好准备`);
        setLotteryStatus(true);
        // 重新抽奖则直接进行抽取，不对上一次的抽奖数据进行保存
        // 抽奖
        resetCard().then(res => {
          // 抽奖
          lottery();
        });
        break;
      // 手动保存本轮抽奖结果
      case "saveData":
        if (currentLuckys.length === 0) {
          addQipao(`本轮还没有抽奖结果，无法保存~~`);
          return;
        }
        saveData().then(() => {
          addQipao(`本轮抽奖结果已保存，可以放心刷新了`);
        });
        break;
      // 导出抽奖结果
      case "save":
        saveData().then(res => {
          resetCard().then(res => {
            // 将之前的记录置空
            currentLuckys = [];
          });
          exportData();
          addQipao(`数据已保存到EXCEL中。`);
        });
        break;
      // 显示/隐藏二维码
      case "qrCode":
        toggleQRDisplay();
        break;
      // 打开可视化配置页面
      case "config":
        toggleConfigModal();
        break;
      // 导入用户列表
      case "importUsers":
        document.querySelector("#usersFileInput").click();
        break;
      // 管理抽奖结果
      case "manageResults":
        toggleManageResults();
        break;
    }
  });

  window.addEventListener("resize", onWindowResize, false);
}

function switchScreen(type) {
  var topBar = document.querySelector("#topBar");
  switch (type) {
    case "enter":
      btns.enter.classList.remove("none");
      btns.lotteryBar.classList.add("none");
      if (topBar) topBar.style.display = "flex";
      transform(targets.table, 2000);
      break;
    default:
      btns.enter.classList.add("none");
      btns.lotteryBar.classList.remove("none");
      if (topBar) topBar.style.display = "none";
      transform(targets.sphere, 2000);
      break;
  }
}

/**
 * 创建元素
 */
function createElement(css, text) {
  let dom = document.createElement("div");
  dom.className = css || "";
  dom.innerHTML = text || "";
  return dom;
}

/**
 * 创建名牌
 */
function createCard(user, isBold, id, showTable) {
  var element = createElement();
  element.id = "card-" + id;

  if (isBold) {
    element.className = "element lightitem";
    if (showTable) {
      element.classList.add("highlight");
    }
  } else {
    element.className = "element";
    element.style.backgroundColor =
      "rgba(0,127,127," + (Math.random() * 0.7 + 0.25) + ")";
  }
  //添加公司标识
  element.appendChild(createElement("company", COMPANY));

  element.appendChild(createElement("name", user[1]));

  element.appendChild(createElement("details", user[0] + "<br/>" + user[2]));
  return element;
}

function removeHighlight() {
  document.querySelectorAll(".highlight").forEach(node => {
    node.classList.remove("highlight");
  });
}

function addHighlight() {
  document.querySelectorAll(".lightitem").forEach(node => {
    node.classList.add("highlight");
  });
}

/**
 * 渲染地球等
 */
function transform(targets, duration) {
  // TWEEN.removeAll();
  for (var i = 0; i < threeDCards.length; i++) {
    var object = threeDCards[i];
    var target = targets[i];

    new TWEEN.Tween(object.position)
      .to(
        {
          x: target.position.x,
          y: target.position.y,
          z: target.position.z
        },
        Math.random() * duration + duration
      )
      .easing(TWEEN.Easing.Exponential.InOut)
      .start();

    new TWEEN.Tween(object.rotation)
      .to(
        {
          x: target.rotation.x,
          y: target.rotation.y,
          z: target.rotation.z
        },
        Math.random() * duration + duration
      )
      .easing(TWEEN.Easing.Exponential.InOut)
      .start();
  }

  new TWEEN.Tween(this)
    .to({}, duration * 2)
    .onUpdate(render)
    .start();
}

// function rotateBall() {
//   return new Promise((resolve, reject) => {
//     scene.rotation.y = 0;
//     new TWEEN.Tween(scene.rotation)
//       .to(
//         {
//           y: Math.PI * 8
//         },
//         ROTATE_TIME
//       )
//       .onUpdate(render)
//       .easing(TWEEN.Easing.Exponential.InOut)
//       .start()
//       .onComplete(() => {
//         resolve();
//       });
//   });
// }

function rotateBall() {
  return new Promise((resolve, reject) => {
    scene.rotation.y = 0;
    rotateObj = new TWEEN.Tween(scene.rotation);
    rotateObj
      .to(
        {
          y: Math.PI * 6 * ROTATE_LOOP
        },
        ROTATE_TIME * ROTATE_LOOP
      )
      .onUpdate(render)
      // .easing(TWEEN.Easing.Linear)
      .start()
      .onStop(() => {
        scene.rotation.y = 0;
        resolve();
      })
      .onComplete(() => {
        resolve();
      });
  });
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  render();
}

function animate() {
  // 让场景通过x轴或者y轴旋转
  // rotate && (scene.rotation.y += 0.088);

  requestAnimationFrame(animate);
  TWEEN.update();
  controls.update();

  // 渲染循环
  // render();
}

function render() {
  renderer.render(scene, camera);
}

function selectCard(duration = 600) {
  rotate = false;
  let width = 140,
    tag = -(currentLuckys.length - 1) / 2,
    locates = [];

  // 计算位置信息, 大于5个分两排显示
  if (currentLuckys.length > 5) {
    let yPosition = [-87, 87],
      l = selectedCardIndex.length,
      mid = Math.ceil(l / 2);
    tag = -(mid - 1) / 2;
    for (let i = 0; i < mid; i++) {
      locates.push({
        x: tag * width * Resolution,
        y: yPosition[0] * Resolution
      });
      tag++;
    }

    tag = -(l - mid - 1) / 2;
    for (let i = mid; i < l; i++) {
      locates.push({
        x: tag * width * Resolution,
        y: yPosition[1] * Resolution
      });
      tag++;
    }
  } else {
    for (let i = selectedCardIndex.length; i > 0; i--) {
      locates.push({
        x: tag * width * Resolution,
        y: 0 * Resolution
      });
      tag++;
    }
  }

  let text = currentLuckys.map(item => item[1]);
  addQipao(
    `恭喜${text.join("、")}获得${currentPrize.title}, 新的一年必定旺旺旺。`
  );

  selectedCardIndex.forEach((cardIndex, index) => {
    changeCard(cardIndex, currentLuckys[index]);
    var object = threeDCards[cardIndex];
    new TWEEN.Tween(object.position)
      .to(
        {
          x: locates[index].x,
          y: locates[index].y * Resolution,
          z: 2200
        },
        Math.random() * duration + duration
      )
      .easing(TWEEN.Easing.Exponential.InOut)
      .start();

    new TWEEN.Tween(object.rotation)
      .to(
        {
          x: 0,
          y: 0,
          z: 0
        },
        Math.random() * duration + duration
      )
      .easing(TWEEN.Easing.Exponential.InOut)
      .start();

    object.element.classList.add("prize");
    tag++;
  });

  new TWEEN.Tween(this)
    .to({}, duration * 2)
    .onUpdate(render)
    .start()
    .onComplete(() => {
      // 动画结束后可以操作
      setLotteryStatus();
      notifyStateChange();
    });
}

/**
 * 重置抽奖牌内容
 */
function resetCard(duration = 500) {
  if (currentLuckys.length === 0) {
    return Promise.resolve();
  }

  selectedCardIndex.forEach(index => {
    let object = threeDCards[index],
      target = targets.sphere[index];

    new TWEEN.Tween(object.position)
      .to(
        {
          x: target.position.x,
          y: target.position.y,
          z: target.position.z
        },
        Math.random() * duration + duration
      )
      .easing(TWEEN.Easing.Exponential.InOut)
      .start();

    new TWEEN.Tween(object.rotation)
      .to(
        {
          x: target.rotation.x,
          y: target.rotation.y,
          z: target.rotation.z
        },
        Math.random() * duration + duration
      )
      .easing(TWEEN.Easing.Exponential.InOut)
      .start();
  });

  return new Promise((resolve, reject) => {
    new TWEEN.Tween(this)
      .to({}, duration * 2)
      .onUpdate(render)
      .start()
      .onComplete(() => {
        selectedCardIndex.forEach(index => {
          let object = threeDCards[index];
          object.element.classList.remove("prize");
        });
        resolve();
      });
  });
}

/**
 * 抽奖
 */
function lottery() {
  btns.lottery.innerHTML = "结束抽奖";
  stopTriggered = false;
  rotateBall().then(() => {
    if (stopTriggered) return;
    selectWinners();
    selectCard();
  });
}

/**
 * 选取中奖者
 */
function selectWinners() {
  currentLuckys = [];
  selectedCardIndex = [];
  // 当前同时抽取的数目,当前奖品抽完还可以继续抽，但是不记录数据
  let perCount = EACH_COUNT[currentPrizeIndex],
    luckyData = basicData.luckyUsers[currentPrize.type],
    leftCount = basicData.leftUsers.length,
    leftPrizeCount = currentPrize.count - (luckyData ? luckyData.length : 0);

  if (leftCount < perCount) {
    addQipao("剩余参与抽奖人员不足，现在重新设置所有人员可以进行二次抽奖！");
    var allLuckyIds = {};
    (basicData.allLuckyUsers || []).forEach(function(u) { allLuckyIds[u[0]] = true; });
    basicData.leftUsers = basicData.users.slice().filter(function(u) {
      return !allLuckyIds[u[0]];
    });
    leftCount = basicData.leftUsers.length;
  }

  while (currentLuckys.length < perCount) {
    basicData.participants = basicData.leftUsers.slice();
    if (currentPrize.type !== defaultType && department_prizes.length > 0) {
      department_prizes.forEach(department => {
        let savedDepartmentLuckyUsers = basicData.allLuckyUsers.filter(item => item[2] == department.department);
        let currentDepartmentLuckyUsers = currentLuckys.filter(item => item[2] == department.department);
        let departmentLuckyUserQuantity = (savedDepartmentLuckyUsers ? savedDepartmentLuckyUsers.length : 0) + (currentDepartmentLuckyUsers ? currentDepartmentLuckyUsers.length : 0);
        if (departmentLuckyUserQuantity >= department.quantity) {
          basicData.participants = basicData.participants.filter(function(item) {
            return item[2] !== department.department;
          });
        }
      });
    }
    leftCount = basicData.participants.length;

    if (leftCount === 0) {
      addQipao("没有更多可参与抽奖的人员了");
      break;
    }

    let luckyId = random(leftCount);
    let currentLuckyUser = basicData.participants.splice(luckyId, 1)[0];
    basicData.leftUsers.splice(basicData.leftUsers.indexOf(currentLuckyUser), 1);
    currentLuckys.push(currentLuckyUser);
    leftPrizeCount--;

    let cardIndex = random(TOTAL_CARDS);
    while (selectedCardIndex.includes(cardIndex)) {
      cardIndex = random(TOTAL_CARDS);
    }
    selectedCardIndex.push(cardIndex);

    if (leftPrizeCount === 0) {
      break;
    }
  }

  console.log(currentLuckys);
  console.log(basicData.luckyUsers);

  updatePrizeDisplay();
}

/**
 * 保存上一次的抽奖结果
 */
function saveData() {
  if (!currentPrize) {
    //若奖品抽完，则不再记录数据，但是还是可以进行抽奖
    return;
  }

  let type = currentPrize.type,
    curLucky = basicData.luckyUsers[type] || [],
    allLuckyUsers=basicData.allLuckyUsers||[];

  curLucky = curLucky.concat(currentLuckys);
  basicData.luckyUsers[type] = curLucky;

  allLuckyUsers=allLuckyUsers.concat(currentLuckys);
  basicData.allLuckyUsers=allLuckyUsers;

  if (currentPrize.count <= curLucky.length) {
    currentPrizeIndex--;
    if (currentPrizeIndex <= -1) {
      currentPrizeIndex = 0;
    }
    currentPrize = basicData.prizes[currentPrizeIndex];
  }

  if (currentLuckys.length > 0) {
    // todo by xc 添加数据保存机制，以免服务器挂掉数据丢失
    return setData(type, currentLuckys);
  }
  return Promise.resolve();
}

function changePrize() {
  let luckys = basicData.luckyUsers[currentPrize.type];
  let luckyCount = (luckys ? luckys.length : 0);
  // 修改左侧prize的数目和百分比
  setPrizeData(currentPrizeIndex, luckyCount);
}

function updatePrizeDisplay() {
  if (!currentPrize || currentPrize.type === defaultType) return;
  var savedCount = (basicData.luckyUsers[currentPrize.type] || []).length;
  setPrizeData(currentPrizeIndex, savedCount + currentLuckys.length);
}

/**
 * 随机抽奖
 */
function random(num) {
  // Math.floor取到0-num-1之间数字的概率是相等的
  return Math.floor(Math.random() * num);
}

/**
 * 切换名牌人员信息
 */
function changeCard(cardIndex, user) {
  let card = threeDCards[cardIndex].element;

  card.innerHTML = `<div class="company">${COMPANY}</div><div class="name">${
    user[1]
  }</div><div class="details">${user[0] || ""}<br/>${user[2] || "PSST"}</div>`;
}

/**
 * 切换名牌背景
 */
function shine(cardIndex, color) {
  let card = threeDCards[cardIndex].element;
  card.style.backgroundColor =
    color || "rgba(0,127,127," + (Math.random() * 0.7 + 0.25) + ")";
}

/**
 * 随机切换背景和人员信息
 */
function shineCard() {
  let maxCard = 10,
    maxUser;
  let shineCard = 10 + random(maxCard);

  setInterval(() => {
    // 正在抽奖停止闪烁
    if (isLotting) {
      return;
    }
    maxUser = basicData.leftUsers.length;
    for (let i = 0; i < shineCard; i++) {
      let index = random(maxUser),
        cardIndex = random(TOTAL_CARDS);
      // 当前显示的已抽中名单不进行随机切换
      if (selectedCardIndex.includes(cardIndex)) {
        continue;
      }
      shine(cardIndex);
      changeCard(cardIndex, basicData.leftUsers[index]);
    }
  }, 500);
}

function setData(type, data) {
  return new Promise((resolve, reject) => {
    window.AJAX({
      url: "/saveData",
      data: {
        type,
        data
      },
      success() {
        resolve();
      },
      error() {
        reject();
      }
    });
  });
}

function setErrorData(data) {
  return new Promise((resolve, reject) => {
    window.AJAX({
      url: "/errorData",
      data: {
        data
      },
      success() {
        resolve();
      },
      error() {
        reject();
      }
    });
  });
}

function exportData() {
  window.AJAX({
    url: "/export",
    success(data) {
      if (data.type === "success") {
        location.href = data.url;
      }
    }
  });
}

function reset() {
  window.AJAX({
    url: "/reset",
    success(data) {
      console.log("重置成功");
    }
  });
}

function createHighlight() {
  let year = new Date().getFullYear() + "";
  let step = 4,
    xoffset = 1,
    yoffset = 1,
    highlight = [];

  year.split("").forEach(n => {
    highlight = highlight.concat(
      NUMBER_MATRIX[n].map(item => {
        return `${item[0] + xoffset}-${item[1] + yoffset}`;
      })
    );
    xoffset += step;
  });

  return highlight;
}

function initWebSocket() {
  let wsUrl = connectionInfo
    ? `http://${connectionInfo.ip}:${connectionInfo.port}`
    : window.location.origin;

  socket = io(wsUrl, {
    query: { role: "display" }
  });

  socket.on("connect", () => {
    console.log("WebSocket connected as display");
    // Start periodic state updates
    if (stateUpdateTimer) clearInterval(stateUpdateTimer);
    stateUpdateTimer = setInterval(sendStateUpdate, 3000);
  });

  socket.on("display:command", (data) => {
    handleRemoteCommand(data);
  });

  socket.on("display:participant_joined", (data) => {
    handleNewParticipant(data);
  });

  socket.on("display:connected", (data) => {
    if (data && data.joinUrl) {
      console.log("Display registered with server");
    }
    if (data) {
      isLotteryStarted = data.isLotteryStarted || false;
      isRegistrationOpen = data.isRegistrationOpen || false;
      updateQROverlay();
    }
  });

  socket.on("display:lottery_started", (data) => {
    if (data) {
      isLotteryStarted = data.started;
      if (data.started) {
        addQipao("抽奖已开始，报名通道关闭");
      } else {
        addQipao("抽奖已重置，报名通道开放");
      }
      updateQROverlay();
    }
  });

  socket.on("display:registration_state", (data) => {
    if (data) {
      isRegistrationOpen = data.open;
      updateQROverlay();
    }
  });

  socket.on("display:config_updated", () => {
    addQipao("配置已更新，正在刷新...");
    setTimeout(() => location.reload(), 500);
  });

  socket.on("disconnect", () => {
    console.log("WebSocket disconnected");
    if (stateUpdateTimer) clearInterval(stateUpdateTimer);
  });
}

function sendStateUpdate() {
  if (!socket || !socket.connected) return;

  let prizeStatuses = (basicData.prizes || []).map((prize, idx) => {
    let lucky = basicData.luckyUsers[prize.type] || [];
    return {
      type: prize.type,
      text: prize.text,
      count: prize.count,
      remaining: Math.max(0, prize.count - lucky.length)
    };
  });

  socket.emit("display:state", {
    currentPrizeIndex: currentPrizeIndex,
    isLotting: isLotting,
    leftCount: basicData.leftUsers ? basicData.leftUsers.length : 0,
    currentPrize: currentPrize ? {
      text: currentPrize.text,
      title: currentPrize.title,
      type: currentPrize.type
    } : null,
    prizeStatuses: prizeStatuses
  });
}

function notifyStateChange() {
  sendStateUpdate();
}

function doStartLottery() {
  if (isLotting) return;
  setLotteryStatus(true);
  saveData();
  changePrize();
  resetCard().then(res => {
    lottery();
  });
  addQipao(`正在抽取[${currentPrize.title}],调整好姿势`);
  btns.lottery.innerHTML = "结束抽奖";
  notifyStateChange();
}

function doStopLottery() {
  if (!isLotting) return;
  stopTriggered = true;
  if (rotateObj && rotateObj.stop) {
    rotateObj.stop();
  }
  scene.rotation.y = 0;
  btns.lottery.innerHTML = "开始抽奖";
  selectWinners();
  selectCard();
  notifyStateChange();
}

function doReset() {
  if (isLotting) return;
  addQipao("重置所有数据，重新抽奖");
  addHighlight();
  resetCard();
  currentLuckys = [];
  basicData.luckyUsers = {};
  basicData.allLuckyUsers=[];
  basicData.participants=[];
  currentPrizeIndex = basicData.prizes.length - 1;
  currentPrize = basicData.prizes[currentPrizeIndex];
  resetPrize(currentPrizeIndex);
  reset();
  totalUsers = 0;
  recentJoins = [];
  isLotteryStarted = false;
  isRegistrationOpen = false;
  // 重新从服务器获取人员列表
  window.AJAX({
    url: "/getUsers",
    success(data) {
      basicData.users = data;
      basicData.leftUsers = Object.assign([], data);
    }
  });
  switchScreen("enter");
  if (socket && socket.connected) {
    socket.emit("display:lottery_reset");
  }
  notifyStateChange();
}

function doReLottery() {
  if (isLotting) return;
  if (currentLuckys.length === 0) {
    addQipao(`当前还没有抽奖，无法重新抽取喔~~`);
    return;
  }
  setErrorData(currentLuckys);
  addQipao(`重新抽取[${currentPrize.title}],做好准备`);
  setLotteryStatus(true);
  resetCard().then(res => {
    lottery();
  });
  notifyStateChange();
}

function doSaveData() {
  if (isLotting) return;
  if (currentLuckys.length === 0) {
    addQipao("本轮还没有抽奖结果，无法保存~~");
    return;
  }
  saveData().then(() => {
    addQipao("本轮抽奖结果已保存，可以放心刷新了");
  });
}

function doExport() {
  if (isLotting) return;
  saveData().then(res => {
    resetCard().then(res => {
      currentLuckys = [];
    });
    exportData();
    addQipao(`数据已保存到EXCEL中。`);
  });
}

function handleRemoteCommand(data) {
  let { action } = data;
  if (!action) return;

  switch (action) {
    case "enter":
      if (!isLotting) document.querySelector("#enter").click();
      break;
    case "start":
    case "toggle":
      doStartLottery();
      break;
    case "stop":
      doStopLottery();
      break;
    case "reset":
      doReset();
      break;
    case "relottery":
      doReLottery();
      break;
    case "export":
      doExport();
      break;
    case "saveData":
      doSaveData();
      break;
    case "toggleQR":
      toggleQRDisplay();
      break;
    case "manageResults":
      toggleManageResults();
      break;
    case "registrationStart":
      if (socket && socket.connected) socket.emit("display:registration_started");
      break;
    case "registrationEnd":
      if (socket && socket.connected) socket.emit("display:registration_ended");
      break;
  }
}

function handleNewParticipant(data) {
  if (!data || !data.user) return;
  let user = data.user;

  // 从服务端重新拉取，确保只有已签到的人进入抽奖池
  window.AJAX({
    url: "/getUsers",
    success(users) {
      basicData.users = users;
    }
  });
  window.AJAX({
    url: "/getTempData",
    success(tempData) {
      basicData.leftUsers = tempData.leftUsers;
    }
  });

  totalUsers = data.checkedInCount || data.totalUsers || totalUsers;
  recentJoins = data.recentParticipants || recentJoins;

  addQipao(`${user[1]} 报名成功`);

  // Show new user on a random card
  let totalCards = threeDCards.length;
  if (totalCards > 0) {
    let randomIdx = Math.floor(Math.random() * totalCards);
    if (!selectedCardIndex.includes(randomIdx)) {
      changeCard(randomIdx, user);
    }
  }

  updateQROverlay();
  notifyStateChange();
}

function buildJoinFeedHTML() {
  let list = (recentJoins || []).slice(0, 10);
  if (list.length === 0) {
    return '<div class="qr-join-empty">等待报名...</div>';
  }
  return list.map(p => {
    let blessingHtml = p.blessing ? ` <span class="qr-join-blessing">${p.blessing}</span>` : "";
    return `<div class="qr-join-item"><span class="qr-join-name">${p.employeeId || ""} ${p.name}</span> 报名成功${blessingHtml}</div>`;
  }).join("");
}

function getStatusText() {
  if (isLotteryStarted) return "抽奖进行中，报名通道已关闭";
  if (isRegistrationOpen) return "报名进行中，请扫码加入";
  return "报名尚未开始";
}

function createQROverlay() {
  let overlay = document.createElement("div");
  overlay.id = "qrOverlay";
  overlay.className = "qr-overlay";

  let total = totalUsers || 0;

  let html = '<div class="qr-panel">';

  html += '<div class="qr-left">';
  if (qrDataURL) {
    html += `<img src="${qrDataURL}" alt="QR Code" class="qr-image">`;
  }
  html += `<div class="qr-status-text">${getStatusText()}</div>`;
  html += '</div>';

  html += '<div class="qr-right">';
  html += `<div class="qr-title">加入年会抽奖</div>`;
  if (connectionInfo) {
    html += `<div class="qr-url">${connectionInfo.joinUrl}</div>`;
  }
  html += `<div class="qr-total">报名人数: <span id="qrTotalCount">${total}</span></div>`;
  html += `<div class="qr-feed-title">报名记录</div>`;
  html += `<div id="qrJoinFeed" class="qr-join-feed">${buildJoinFeedHTML()}</div>`;
  html += '</div>';

  html += '<div class="qr-bottom">';
  if (isRegistrationOpen) {
    html += '<button id="qrRegBtn" class="qr-reg-btn qr-reg-end">结束报名</button>';
  } else {
    html += '<button id="qrRegBtn" class="qr-reg-btn qr-reg-start">开始报名</button>';
  }
  html += '<button id="qrCloseBtn" class="qr-close-btn">关闭</button>';
  html += '</div>';

  html += '</div>';

  overlay.innerHTML = html;
  return overlay;
}

function updateQROverlay() {
  let overlay = document.querySelector("#qrOverlay");
  if (!overlay) return;

  let countEl = overlay.querySelector("#qrTotalCount");
  if (countEl) {
    countEl.textContent = totalUsers || 0;
  }

  let feedEl = overlay.querySelector("#qrJoinFeed");
  if (feedEl) {
    feedEl.innerHTML = buildJoinFeedHTML();
  }

  let statusEl = overlay.querySelector(".qr-status-text");
  if (statusEl) {
    statusEl.textContent = getStatusText();
  }

  let regBtn = overlay.querySelector("#qrRegBtn");
  if (regBtn) {
    if (isRegistrationOpen) {
      regBtn.textContent = "结束报名";
      regBtn.className = "qr-reg-btn qr-reg-end";
    } else {
      regBtn.textContent = "开始报名";
      regBtn.className = "qr-reg-btn qr-reg-start";
    }
  }
}

function toggleQRDisplay() {
  let existing = document.querySelector("#qrOverlay");
  if (existing) {
    existing.remove();
    return;
  }

  if (!qrDataURL && !connectionInfo) {
    addQipao("二维码尚未生成，请稍后");
    return;
  }

  let overlay = createQROverlay();
  document.body.appendChild(overlay);

  overlay.querySelector("#qrCloseBtn").addEventListener("click", () => {
    overlay.remove();
  });

  overlay.querySelector("#qrRegBtn").addEventListener("click", () => {
    if (isRegistrationOpen) {
      if (socket && socket.connected) {
        socket.emit("display:registration_ended");
      }
    } else {
      if (socket && socket.connected) {
        socket.emit("display:registration_started");
      }
    }
  });
}

function showConfirm(message) {
  return new Promise(function(resolve) {
    var overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML =
      '<div class="confirm-dialog">' +
      '<div class="confirm-body">' +
      '<div class="confirm-icon warn">!</div>' +
      '<div class="confirm-message">' + message + '</div>' +
      '</div>' +
      '<div class="confirm-footer">' +
      '<button class="confirm-btn confirm-btn-cancel">取消</button>' +
      '<button class="confirm-btn confirm-btn-ok">确认</button>' +
      '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    overlay.querySelector(".confirm-btn-cancel").addEventListener("click", function() {
      overlay.remove();
      resolve(false);
    });
    overlay.querySelector(".confirm-btn-ok").addEventListener("click", function() {
      overlay.remove();
      resolve(true);
    });
    overlay.addEventListener("click", function(e) {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    });
  });
}

function toggleConfigModal() {
  var existing = document.querySelector("#configOverlay");
  if (existing) {
    existing.remove();
    return;
  }

  var overlay = document.createElement("div");
  overlay.id = "configOverlay";
  overlay.className = "config-overlay";
  overlay.innerHTML =
    '<div class="config-modal">' +
    '<div class="config-modal-header">' +
    '<span class="config-modal-title">抽奖配置</span>' +
    '<button id="configCloseBtn" class="config-close-btn">&times;</button>' +
    '</div>' +
    '<iframe id="configIframe" class="config-iframe" src="/config.html"></iframe>' +
    '</div>';

  document.body.appendChild(overlay);

  overlay.querySelector("#configCloseBtn").addEventListener("click", function() {
    overlay.remove();
  });

  overlay.addEventListener("click", function(e) {
    if (e.target === overlay) overlay.remove();
  });
}

function toggleManageResults() {
  var existing = document.querySelector("#manageOverlay");
  if (existing) {
    existing.remove();
    return;
  }

  var overlay = document.createElement("div");
  overlay.id = "manageOverlay";
  overlay.className = "manage-overlay";
  overlay.innerHTML =
    '<div class="manage-modal">' +
    '<div class="manage-modal-header">' +
    '<span class="manage-modal-title">中奖结果管理</span>' +
    '<button id="manageCloseBtn" class="manage-close-btn">&times;</button>' +
    '</div>' +
    '<div class="manage-content" id="manageContent"></div>' +
    '<div class="manage-footer" id="manageFooter">' +
    '<span class="manage-selected-count" id="manageSelectedCount">已选 0 人</span>' +
    '<button id="manageBatchBtn" class="manage-batch-btn" disabled>批量作废</button>' +
    '</div>' +
    '</div>';

  document.body.appendChild(overlay);

  overlay.querySelector("#manageCloseBtn").addEventListener("click", function() {
    overlay.remove();
  });
  overlay.addEventListener("click", function(e) {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector("#manageBatchBtn").addEventListener("click", function() {
    batchInvalidate();
  });

  renderManageContent();

  // 监听所有复选框变化，更新计数和按钮状态
  var content = overlay.querySelector("#manageContent");
  content.addEventListener("change", function(e) {
    if (e.target.classList.contains("manage-checkbox")) {
      updateBatchUI();
    }
  });
}

function renderManageContent() {
  var content = document.querySelector("#manageContent");
  if (!content) return;

  var prizesSorted = (prizes || []).slice().sort(function(a, b) { return a.type - b.type; });
  var hasAny = false;
  var html = "";

  prizesSorted.forEach(function(prize) {
    if (prize.type === defaultType) return;
    var luckyList = basicData.luckyUsers[prize.type];
    if (!luckyList || luckyList.length === 0) return;
    hasAny = true;
    html += '<div class="manage-group">';
    html += '<div class="manage-group-title">';
    html += '<label class="manage-select-all-label"><input type="checkbox" class="manage-select-all" data-type="' + prize.type + '"> 全选</label>';
    html += prize.text + (prize.title ? " " + prize.title : "") + "（" + luckyList.length + "/" + prize.count + "）";
    html += "</div>";
    luckyList.forEach(function(user) {
      html += '<div class="manage-row">';
      html += '<label class="manage-row-label">';
      html += '<input type="checkbox" class="manage-checkbox" data-type="' + prize.type + '" data-empid="' + user[0] + '">';
      html += '<span class="manage-row-info"><span class="emp-id">' + (user[0] || "") + '</span>' + (user[1] || "") + " - " + (user[2] || "") + "</span>";
      html += "</label>";
      html += '<button class="manage-invalidate-btn" data-type="' + prize.type + '" data-empid="' + user[0] + '">作废</button>';
      html += "</div>";
    });
    html += "</div>";
  });

  if (!hasAny) {
    html = '<div class="manage-empty">暂无中奖记录</div>';
  }

  content.innerHTML = html;

  // 绑定单个作废按钮事件
  var btns = content.querySelectorAll(".manage-invalidate-btn");
  btns.forEach(function(btn) {
    btn.addEventListener("click", function() {
      var type = parseInt(this.dataset.type, 10);
      var empId = this.dataset.empid;
      invalidateWinner(type, empId);
    });
  });

  // 绑定全选复选框事件
  var selectAlls = content.querySelectorAll(".manage-select-all");
  selectAlls.forEach(function(sa) {
    sa.addEventListener("change", function() {
      var type = this.dataset.type;
      var checked = this.checked;
      var checkboxes = content.querySelectorAll(".manage-checkbox[data-type=\"" + type + "\"]");
      checkboxes.forEach(function(cb) { cb.checked = checked; });
      updateBatchUI();
    });
  });

  updateBatchUI();
}

function updateBatchUI() {
  var checked = document.querySelectorAll(".manage-checkbox:checked");
  var count = checked.length;
  var countEl = document.querySelector("#manageSelectedCount");
  var batchBtn = document.querySelector("#manageBatchBtn");
  if (countEl) countEl.textContent = "已选 " + count + " 人";
  if (batchBtn) {
    batchBtn.disabled = count === 0;
    batchBtn.textContent = count > 0 ? "批量作废（" + count + "）" : "批量作废";
  }
}

function batchInvalidate() {
  var checked = document.querySelectorAll(".manage-checkbox:checked");
  if (checked.length === 0) return;

  // 收集选中用户信息用于显示
  var names = [];
  var items = [];
  checked.forEach(function(cb) {
    var row = cb.closest(".manage-row");
    var info = row ? row.querySelector(".manage-row-info") : null;
    var name = info ? info.textContent.trim() : "";
    names.push(name);
    items.push({ type: parseInt(cb.dataset.type, 10), employeeId: cb.dataset.empid });
  });

  showConfirm("确认批量作废以下 " + items.length + " 人的中奖记录？\n\n" + names.join("\n") + "\n\n作废后这些人员将不能再次参与抽奖，对应奖项名额将恢复。").then(function(confirmed) {
    if (!confirmed) return;

    var total = items.length;
    var done = 0;
    var failed = [];

    function processNext(index) {
      if (index >= total) {
        finishBatch();
        return;
      }
      var item = items[index];
      window.AJAX({
        url: "/invalidateWinner",
        data: { type: item.type, employeeId: String(item.employeeId) },
        success: function(result) {
          if (result.type === "success") {
            done++;
          } else {
            failed.push(item.employeeId);
          }
          processNext(index + 1);
        },
        error: function() {
          failed.push(item.employeeId);
          processNext(index + 1);
        }
      });
    }

    function finishBatch() {
      items.forEach(function(item) {
        if (failed.indexOf(item.employeeId) !== -1) return;
        var luckyList = basicData.luckyUsers[item.type];
        if (luckyList) {
          var idx = luckyList.findIndex(function(u) { return String(u[0]) === String(item.employeeId); });
          if (idx !== -1) luckyList.splice(idx, 1);
        }
        var allIdx = basicData.allLuckyUsers.findIndex(function(u) { return String(u[0]) === String(item.employeeId); });
        if (allIdx !== -1) basicData.allLuckyUsers.splice(allIdx, 1);
      });

      // 将旧卡片移回球面位置，再清空状态
      var cardsToReset = selectedCardIndex.slice();
      cardsToReset.forEach(function(idx) {
        var obj = threeDCards[idx];
        if (obj && obj.element) obj.element.classList.remove("prize");
        var target = targets.sphere[idx];
        if (target) {
          new TWEEN.Tween(obj.position)
            .to({ x: target.position.x, y: target.position.y, z: target.position.z }, 400)
            .easing(TWEEN.Easing.Exponential.InOut)
            .start();
          new TWEEN.Tween(obj.rotation)
            .to({ x: target.rotation.x, y: target.rotation.y, z: target.rotation.z }, 400)
            .easing(TWEEN.Easing.Exponential.InOut)
            .start();
        }
      });
      currentLuckys = [];
      selectedCardIndex = [];

      window.AJAX({
        url: "/getTempData",
        success: function(data) {
          basicData.leftUsers = data.leftUsers;
        }
      });

      var newIdx = basicData.prizes.length - 1;
      for (; newIdx > -1; newIdx--) {
        var p = basicData.prizes[newIdx];
        var lucky = basicData.luckyUsers[p.type];
        if (!lucky || lucky.length < p.count) {
          break;
        }
      }
      if (newIdx >= 0 && newIdx !== currentPrizeIndex) {
        currentPrizeIndex = newIdx;
        currentPrize = basicData.prizes[currentPrizeIndex];
      }

      resetPrize(currentPrizeIndex);
      var curLucky = basicData.luckyUsers[currentPrize.type];
      setPrizeData(currentPrizeIndex, curLucky ? curLucky.length : 0, true);

      renderManageContent();

      if (failed.length > 0) {
        addQipao("批量作废完成：" + done + " 人成功，" + failed.length + " 人失败");
      } else {
        addQipao("批量作废完成，共作废 " + done + " 人");
      }
    }

    processNext(0);
  });
}

function invalidateWinner(type, employeeId) {
  var user = null;
  var luckyList = basicData.luckyUsers[type];
  if (luckyList) {
    user = luckyList.find(function(item) { return String(item[0]) === String(employeeId); });
  }
  var userName = user ? user[1] : employeeId;

  showConfirm("确认作废 [" + userName + "] 的中奖记录？\n\n作废后该人员将不能再次参与抽奖，对应奖项名额将恢复。").then(function(confirmed) {
    if (!confirmed) return;

    window.AJAX({
      url: "/invalidateWinner",
      data: { type: type, employeeId: String(employeeId) },
      success: function(result) {
        if (result.type === "success") {
          if (luckyList) {
            var idx = luckyList.findIndex(function(item) { return String(item[0]) === String(employeeId); });
            if (idx !== -1) luckyList.splice(idx, 1);
          }
          var allIdx = basicData.allLuckyUsers.findIndex(function(item) { return String(item[0]) === String(employeeId); });
          if (allIdx !== -1) basicData.allLuckyUsers.splice(allIdx, 1);

          // 将旧卡片移回球面位置，再清空状态
          var cardsToReset = selectedCardIndex.slice();
          cardsToReset.forEach(function(idx) {
            var obj = threeDCards[idx];
            if (obj && obj.element) obj.element.classList.remove("prize");
            var target = targets.sphere[idx];
            if (target) {
              new TWEEN.Tween(obj.position)
                .to({ x: target.position.x, y: target.position.y, z: target.position.z }, 400)
                .easing(TWEEN.Easing.Exponential.InOut)
                .start();
              new TWEEN.Tween(obj.rotation)
                .to({ x: target.rotation.x, y: target.rotation.y, z: target.rotation.z }, 400)
                .easing(TWEEN.Easing.Exponential.InOut)
                .start();
            }
          });
          currentLuckys = [];
          selectedCardIndex = [];

          window.AJAX({
            url: "/getTempData",
            success: function(data) {
              basicData.leftUsers = data.leftUsers;
            }
          });

          var newIdx = basicData.prizes.length - 1;
          for (; newIdx > -1; newIdx--) {
            var p = basicData.prizes[newIdx];
            var lucky = basicData.luckyUsers[p.type];
            if (!lucky || lucky.length < p.count) {
              break;
            }
          }
          if (newIdx >= 0 && newIdx !== currentPrizeIndex) {
            currentPrizeIndex = newIdx;
            currentPrize = basicData.prizes[currentPrizeIndex];
          }

          resetPrize(currentPrizeIndex);
          var curLucky = basicData.luckyUsers[currentPrize.type];
          setPrizeData(currentPrizeIndex, curLucky ? curLucky.length : 0, true);

          renderManageContent();

          addQipao("已作废 [" + userName + "] 的中奖记录");
        } else {
          addQipao(result.message || "作废失败");
        }
      },
      error: function() {
        addQipao("网络错误，作废失败");
      }
    });
  });
}

// 监听来自 config iframe 的保存成功消息
window.addEventListener("message", function(e) {
  if (e.data === "config_saved") {
    addQipao("配置已更新，正在刷新...");
    setTimeout(function() { location.reload(); }, 500);
  }
});

// 导入用户列表文件处理
document.addEventListener("DOMContentLoaded", function() {
  var usersFileInput = document.querySelector("#usersFileInput");
  if (usersFileInput) {
    usersFileInput.addEventListener("change", function() {
      var file = this.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(e) {
        fetch("/uploadUsers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, data: e.target.result })
        })
        .then(function(r) { return r.json(); })
        .then(function(result) {
          if (result.type === "success") {
            addQipao(result.message || "导入成功");
            // 重置本地数据
            basicData.luckyUsers = {};
            basicData.allLuckyUsers = [];
            basicData.participants = [];
            currentLuckys = [];
            currentPrizeIndex = basicData.prizes.length - 1;
            currentPrize = basicData.prizes[currentPrizeIndex];
            isLotteryStarted = false;
            isRegistrationOpen = false;
            totalUsers = result.totalUsers || 0;
            recentJoins = [];
            resetPrize(currentPrizeIndex);
            addHighlight();
            switchScreen("enter");
            // 重新拉取用户
            window.AJAX({
              url: "/getUsers",
              success: function(users) {
                basicData.users = users;
                basicData.leftUsers = Object.assign([], users);
                // 刷新名牌
                threeDCards.forEach(function(obj, idx) {
                  var u = users[idx % users.length];
                  if (u) changeCard(idx, u);
                });
              }
            });
            window.AJAX({
              url: "/getTempData",
              success: function(tempData) {
                basicData.leftUsers = tempData.leftUsers;
              }
            });
          } else {
            addQipao(result.message || "导入失败");
          }
        })
        .catch(function() {
          addQipao("网络错误，导入失败");
        });
      };
      reader.readAsDataURL(file);
      this.value = "";
    });
  }
});

let onload = window.onload;

window.onload = function () {
  onload && onload();

  let music = document.querySelector("#music");

  let rotated = 0,
    stopAnimate = false,
    musicBox = document.querySelector("#musicBox");

  function animate() {
    requestAnimationFrame(function () {
      if (stopAnimate) {
        return;
      }
      rotated = rotated % 360;
      musicBox.style.transform = "rotate(" + rotated + "deg)";
      rotated += 1;
      animate();
    });
  }

  musicBox.addEventListener(
    "click",
    function (e) {
      if (music.paused) {
        music.play().then(
          () => {
            stopAnimate = false;
            animate();
          },
          () => {
            addQipao("背景音乐自动播放失败，请手动播放！");
          }
        );
      } else {
        music.pause();
        stopAnimate = true;
      }
    },
    false
  );

  setTimeout(function () {
    musicBox.click();
  }, 1000);
};
