/**
 * 奖品设置
 * type: 唯一标识，0是默认特别奖的占位符，其它奖品不可使用
 * count: 奖品数量
 * title: 奖品描述
 * text: 奖品标题
 * img: 图片地址
 */
const prizes = [
  {
    "type": 0,
    "text": "特别奖",
    "title": "",
    "count": 1000,
    "img": ""
  },
  {
    "type": 1,
    "text": "一等奖",
    "title": "7000元购物卡",
    "count": 5,
    "img": "../img/nesting.png"
  },
  {
    "type": 2,
    "text": "二等奖",
    "title": "5000元购物卡",
    "count": 20,
    "img": "../img/图片1.png"
  },
  {
    "type": 3,
    "text": "三等奖",
    "title": "3000元购物卡",
    "count": 20,
    "img": "../img/nesting.png"
  },
  {
    "type": 4,
    "text": "四等奖",
    "title": "2000元购物卡",
    "count": 20,
    "img": "../img/nesting.png"
  }
];

/**
 * 一次抽取的奖品个数与prizes对应
 */
const EACH_COUNT = [1,2,5,5,5];

/**
 * 卡片公司名称标识
 */
const COMPANY = "DDSLAB";

/**
 * 报名可选部门（若为空则自动从可报名清单中读取）
 */
const DEPARTMENTS = [];

/**
 * 部门最大中奖人数
 * department: 部门
 * quantity: 中奖数量
 */
const department_prizes = [];
module.exports = {
  prizes,
  EACH_COUNT,
  COMPANY,
  DEPARTMENTS,
  department_prizes
};
