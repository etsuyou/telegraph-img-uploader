const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");
const IMGS_CONFIG = require("./config");

// 配置项
const CONFIG = {
  PAGE_URL: IMGS_CONFIG.PAGE_URL,
  TELEGRAPH_TITLE: IMGS_CONFIG.TELEGRAPH_TITLE,
  IMAGE_DIR: IMGS_CONFIG.IMAGE_DIR,
  BASE_URL: "https://im.gurl.eu.org",
  ALLOWED_EXT: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
  CONCURRENCY: 10,
  MD_AUTHOR: "Kafu Chino",
  TELEGRAPH_SHORT_NAME: "BocchiUploader",
  TELEGRAPH_AUTHOR: "Kafu Chino",
  AUTHOR_URL: "https://github.com/etsuyou/telegraph-img-uploader",
  RETRY_TIMES: 10,
  RETRY_DELAY: 10000,
  LOG_DIR: "./output/logs", // 新增日志目录配置
};

// 动态生成的markdown文件路径
CONFIG.RESULT_MD = `./output/${CONFIG.PAGE_URL}.md`;
CONFIG.RESULT_JSON = `./output/${CONFIG.PAGE_URL}.json`;

// 日志函数
function writeLog(level, message) {
  try {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;

    // 控制台输出
    if (level === "ERROR") {
      console.error(logMessage);
    } else {
      console.log(logMessage);
    }

    // 确保日志目录存在
    if (!fs.existsSync(CONFIG.LOG_DIR)) {
      fs.mkdirSync(CONFIG.LOG_DIR, { recursive: true });
    }

    // 写入日志文件（按日期分割）
    const logDate = timestamp.split("T")[0];
    const logPath = path.join(
      CONFIG.LOG_DIR,
      `${logDate}-${CONFIG.PAGE_URL}.log`
    );
    fs.appendFileSync(logPath, logMessage, { flag: "a" });
  } catch (error) {
    console.error(`无法写入日志文件: ${error.message}`);
  }
}

// 获取图片文件列表
function getImageFiles() {
  try {
    if (!fs.existsSync(CONFIG.IMAGE_DIR)) {
      throw new Error(`图片目录 ${CONFIG.IMAGE_DIR} 不存在`);
    }

    const files = fs.readdirSync(CONFIG.IMAGE_DIR);
    const imageFiles = files.filter((file) =>
      CONFIG.ALLOWED_EXT.includes(path.extname(file).toLowerCase())
    );

    if (imageFiles.length === 0) {
      throw new Error(`在 ${CONFIG.IMAGE_DIR} 中未找到支持的图片文件`);
    }

    return imageFiles;
  } catch (error) {
    writeLog("ERROR", `初始化错误: ${error.message}`);
    process.exit(1);
  }
}

// 带重试机制的上传函数
async function uploadFile(file, index, total) {
  let retryCount = 0;

  while (retryCount <= CONFIG.RETRY_TIMES) {
    try {
      writeLog(
        "INFO",
        `[${index + 1}/${total}] 正在上传 ${file}${
          retryCount > 0 ? ` (第 ${retryCount} 次重试)` : ""
        }`
      );

      const formData = new FormData();
      const filePath = path.join(CONFIG.IMAGE_DIR, file);
      formData.append("file", fs.createReadStream(filePath));

      const response = await axios.post(`${CONFIG.BASE_URL}/upload`, formData, {
        headers: formData.getHeaders(),
      });

      return {
        filename: file,
        url: `${CONFIG.BASE_URL}${response.data[0].src}`,
        status: "success",
        retries: retryCount,
      };
    } catch (error) {
      if (retryCount === CONFIG.RETRY_TIMES) {
        writeLog("ERROR", `${file}: 超过最大重试次数 (${CONFIG.RETRY_TIMES})`);
        return {
          filename: file,
          url: null,
          status: "error",
          error: error.message,
          retries: retryCount,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, CONFIG.RETRY_DELAY));
      retryCount++;
    }
  }
}

// 并发控制上传
async function concurrentUpload(files) {
  const total = files.length;
  writeLog("INFO", `发现 ${total} 张图片，开始上传...`);

  const results = [];
  for (let i = 0; i < files.length; i++) {
    const result = await uploadFile(files[i], i, total);
    results.push(result);
    process.stdout.write(
      `进度: ${i + 1}/${total} (${Math.round(((i + 1) / total) * 100)}%)\r`
    );
  }

  return results;
}

// 生成 Markdown
function generateMarkdown(items, accessToken, url) {
  const currentYear = new Date().getFullYear();
  return [
    `# ${CONFIG.TELEGRAPH_TITLE}\n`,
    `**上传者**: ${CONFIG.MD_AUTHOR}`,
    `**accessToken**: ${accessToken}`,
    `**url**: ${url}`,
    `**图片数量**: ${items.length}\n\n`,
    ...items.map((item) => `![${item.filename}](${item.url})`),
    "\n\n> 本文件由自动上传脚本生成",
  ].join("\n");
}

// 创建 Telegraph 账户
async function createTelegraphAccount() {
  try {
    const response = await axios.post(
      "https://api.telegra.ph/createAccount",
      new URLSearchParams({
        short_name: CONFIG.TELEGRAPH_SHORT_NAME,
        author_name: CONFIG.TELEGRAPH_AUTHOR,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    if (response.data.ok) {
      writeLog("INFO", "Telegraph 账户创建成功");
      return response.data.result.access_token;
    }
    throw new Error(response.data.error);
  } catch (error) {
    writeLog("ERROR", `创建 Telegraph 账户失败: ${error.message}`);
    throw error;
  }
}

// 创建 Telegraph 页面
async function createTelegraphPage(accessToken, images) {
  try {
    const content = [
      { tag: "p", children: [`共上传 ${images.length} 张图片`] },
      ...images.map((img) => ({
        tag: "figure",
        children: [
          { tag: "img", attrs: { src: img.url } },
          { tag: "figcaption", children: [img.filename] },
        ],
      })),
    ];

    const currentYear = new Date().getFullYear();

    const response = await axios.post(
      "https://api.telegra.ph/createPage",
      new URLSearchParams({
        access_token: accessToken,
        title: CONFIG.PAGE_URL + `-${currentYear}`,
        content: JSON.stringify(content),
        return_content: false,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    if (response.data.ok) {
      writeLog("INFO", "Telegraph 页面创建成功");
      return response.data.result.url;
    }
    throw new Error(response.data.error);
  } catch (error) {
    writeLog("ERROR", `创建 Telegraph 页面失败: ${error.message}`);
    throw error;
  }
}

// 修改 Telegraph 页面
async function editTelegraphPage(accessToken, path, newTitle, content) {
  try {
    const response = await axios.post(
      `https://api.telegra.ph/editPage/${path}`,
      new URLSearchParams({
        access_token: accessToken,
        title: newTitle,
        content: JSON.stringify(content),
        return_content: true,
        author_name: CONFIG.TELEGRAPH_AUTHOR,
        author_url: CONFIG.AUTHOR_URL,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    if (response.data.ok) {
      writeLog("INFO", "页面标题修改成功");
      return response.data.result.url;
    }
    throw new Error(response.data.error);
  } catch (error) {
    writeLog("ERROR", `修改 Telegraph 页面失败: ${error.message}`);
    throw error;
  }
}

// 主流程
async function main() {
  writeLog("INFO", "程序启动");
  try {
    // 确保输出目录存在
    [CONFIG.LOG_DIR, path.dirname(CONFIG.RESULT_JSON)].forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    let results = null;
    let imageFiles = null;
    if (!(await fs.existsSync(CONFIG.RESULT_JSON))) {
      // 上传图片
      imageFiles = getImageFiles();
      results = await concurrentUpload(imageFiles);

      // 保存结果
      fs.writeFileSync(CONFIG.RESULT_JSON, JSON.stringify(results, null, 2));
    } else {
      // 如果文件存在，读取结果
      results = JSON.parse(fs.readFileSync(CONFIG.RESULT_JSON, "utf-8"));
    }

    // 确保 results 不为 null
    if (results === null) {
      results = []; // 或者你可以选择抛出一个错误
    }

    const successResults = results.filter((item) => item.status === "success");

    if (successResults.length > 0) {
      const accessToken = await createTelegraphAccount();
      writeLog("INFO", `获取 accessToken: ${accessToken}`);

      // 创建 Telegraph 页面
      const pageUrl = await createTelegraphPage(accessToken, successResults);
      // writeLog("INFO", `Telegraph 页面地址：${pageUrl}`);

      // 修改 Telegraph 页面标题
      const pagePath = pageUrl.split("/").pop();
      const updatedPageUrl = await editTelegraphPage(
        accessToken,
        pagePath,
        CONFIG.TELEGRAPH_TITLE,
        successResults.map((img) => ({
          tag: "figure",
          children: [
            { tag: "img", attrs: { src: img.url } },
            { tag: "figcaption", children: [img.filename] },
          ],
        }))
      );
      writeLog("INFO", `最终页面地址：${updatedPageUrl}`);

      // 生成markdown
      fs.writeFileSync(
        CONFIG.RESULT_MD,
        generateMarkdown(successResults, accessToken, updatedPageUrl)
      );
    }

    writeLog(
      "INFO",
      `\n上传完成！\n成功上传 ${successResults.length}/${imageFiles.length} 张图片`
    );
    writeLog("INFO", `JSON 结果：${path.resolve(CONFIG.RESULT_JSON)}`);
    writeLog("INFO", `Markdown 文件：${path.resolve(CONFIG.RESULT_MD)}`);
    writeLog("INFO", "程序正常退出");
  } catch (error) {
    writeLog("ERROR", `程序运行出错: ${error.message}`);
    process.exit(1);
  }
}

// 启动程序
main();
