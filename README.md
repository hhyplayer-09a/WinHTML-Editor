# **WinHTML Editor - 构建指南 (Build Guide)**

本指南将帮助您在本地环境从源码编译并构建 **WinHTML Editor**。本项目采用 **React (Frontend)** + **Go (Backend)** 的架构，最终打包为单文件的 Windows 可执行程序 (.exe)。

## **📋 环境准备 (Prerequisites)**

在开始构建之前，请确保您的开发环境已安装以下工具，并已正确配置到系统环境变量 (PATH) 中：

1.  **Go (Golang)**

    *   版本要求: 1.18 或更高版本 (支持 embed 特性)。

    *   下载地址: **https://go.dev/dl/**

    *   验证: 在终端输入 go version。

2.  **Node.js & npm**

    *   用于构建前端 React 项目。

    *   建议版本: LTS (长期支持版)。

    *   下载地址: **https://nodejs.org/**

    *   验证: 在终端输入 node -v 和 npm -v。

3.  **Git** (可选，用于克隆代码)

    *   下载地址: **https://git-scm.com/**

* * *

## **🛠 手动构建 (分步指南)**

如果您希望了解构建细节，或遇到脚本无法运行的情况，请按照以下步骤手动构建：

### **第一步：构建前端 (React)**

前端代码需要先编译成静态 HTML/CSS/JS 文件，以便 Go 后端进行嵌入。

1. 在项目根目录下打开终端。

2. 安装前端依赖：

   ```
   npm install
   ```

3. 执行 Vite 构建命令：

   ```
   npm run build
   ```

4. **检查结果**: 确保根目录下生成了 dist 文件夹，且文件夹内包含 index.html 和资源文件。

### **第二步：构建后端 (Go)**

Go 程序会将 dist 目录嵌入到二进制文件中，并编译为 Windows 可执行程序。

1. 初始化一个新的go模块：

   `go mod init winhtml-editor`

2. 整理 Go 依赖：

   ```
   go mod tidy
   ```

3. 编译生成 .exe 文件：

   ```
   go build -ldflags "-s -w -H=windowsgui" -o WinHTMLEditor.exe .
   ```

   *   **参数说明**:
       *   \-s -w: 去除调试信息和符号表，减小文件体积。
       *   \-H=windowsgui: 设置为 Windows GUI 程序，**运行时不显示黑色命令行窗口**。

* * *

## **🎨 添加应用图标 (可选)**

如果您希望生成的 .exe 文件带有自定义图标（而不是 Windows 默认图标），请执行以下步骤：

1. 准备一个 .png 图标文件，命名为 icon.png，放在项目根目录。

2. 安装 go-winres 工具：

   ```
   go install github.com/tc-hib/go-winres@latest
   ```

3. 生成资源文件 (.syso)：

   ```
   go-winres make
   ```

4. 重新执行上述的 **Go 编译命令**，图标将自动包含在内。

* * *

## **❓ 常见问题 (Troubleshooting)**

**Q1: 运行** **build.bat** **时提示 "'npm' 不是内部或外部命令"？**

> **A:** 您没有安装 Node.js 或者没有将其添加到系统 PATH 环境变量中。请重新安装 Node.js。

**Q2: 编译时提示** **pattern dist: no matching files found****？**

> **A:** 这意味着前端构建失败，或者您跳过了前端构建步骤。Go 代码依赖 dist 文件夹。请确保先运行 npm run build。

**Q3: 程序运行后是一个黑框框（命令行窗口）？**

> **A:** 这是一个 GUI 程序。请确保在 go build 时加上了 \-ldflags "-H=windowsgui" 参数来隐藏控制台窗口。

**Q4: 修改了** **index.tsx** **或 CSS，但运行 exe 没有变化？**

> **A:** 每次修改前端代码后，必须**重新运行** npm run build 来更新 dist 目录，然后**重新运行** go build 重新打包 exe。
