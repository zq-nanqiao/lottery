const baseConfig = require("./webpack.config");
const merge = require("webpack-merge");
const serve = require("../server/server.js");

module.exports = merge(baseConfig, {
  devtool: "#eval-source-map",
  devServer: {
    hot: true,
    compress: true,
    port: 9000,
    open: true,
    proxy: {
      "*": {
        target: "http://localhost:18888",
        bypass: function(req) {
          if (req.url.indexOf("sockjs-node") !== -1) return false;
        }
      }
    },
    before() {
      serve.run(18888, "n");
    }
  }
});
