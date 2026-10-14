# KA's blog

由hugo + blowfish搭建的博客。

## 如何搓出这种答辩博客

### 基础环境

~当然是交给ai啦~

先在这里下载hugo：https://github.com/gohugoio/hugo

创建站点：

```bash
hugo new site <dir>
```

在站点内开一个仓库：

```bash
cd quickstart
git init
```

### 主题设置

两种方法，如果你需要时刻保持主题最新，那就用git子模块

```bash
git submodule add -b main https://github.com/nunocoracao/blowfish.git themes/blowfish
```

或者直接当作普通文件导入，不会出现一些子模块冲突的问题，可以搞一下自定义，缺点是**更新很麻烦**

```bash
git clone https://github.com/nunocoracao/blowfish.git themes/blowfish
cd themes/blowfish
rm -r .git
```

指定主题：

```bash
cd ../../
vim hugo.toml
```

配置可以这样参考：

```toml
baseURL = 'https://kioroshiaki.github.io/'
languageCode = 'zh-cn'
title = 'test'
theme = 'blowfish'
```

把主题提供的默认配置文件copy到hugo的配置文件目录里

```bash
cd themes/blowfish/config/
cp _default ../../../config/
```

里面有.en的文件，改成自己的语言即可，比如zh-CN

可以参考官方文档，按自己喜欢的方式处理这些配置文件：https://blowfish.page/

### github page部署

先创建github库，名字必须为 用户名.github.io

在settings - pages可以看见博客的url

推送前可以尝试本地预览一下：

```bash
hugo server --buildDrafts --disableFastRender
```

没问题的话就可以开始了，github上传可能需要配置一下密钥，这里可以参考这篇文章：https://blog.csdn.net/weixin_42310154/article/details/118340458

回到博客主目录，开始推送：

```
git switch -c main
git add .
git commit -m "更新说明"
git push <url> main
```

接下来开始创建工作流，让github每次push时自动给我们部署：

新建`.github/workflows`目录，创建hugo.yaml，把这个直接复制进去

```yml
# 用于构建和部署Hugo网站到GitHub Pages的示例工作流程
name: 发布Hugo网站到Pages

on:
  # 在目标为默认分支的推送上运行
  push:
    branches:
      - main

  # 允许您手动从“Actions”标签运行此工作流程
  workflow_dispatch:

# 设置GITHUB_TOKEN的权限，以允许部署到GitHub Pages
permissions:
  contents: read
  pages: write
  id-token: write

# 仅允许一个并发部署，跳过在进行中的运行与最新排队的运行之间排队的运行。
# 但是，请不要取消进行中的运行，因为我们希望这些生产部署能够完成。
concurrency:
  group: "pages"
  cancel-in-progress: false

# 默认使用bash
defaults:
  run:
    shell: bash

jobs:
  # 构建作业
  build:
    runs-on: ubuntu-latest
    env:
      HUGO_VERSION: 0.120.2 # 改成新版本
    steps:
      - name: 安装Hugo CLI
        run: |
          wget -O ${{ runner.temp }}/hugo.deb https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}/hugo_extended_${HUGO_VERSION}_linux-amd64.deb \
          && sudo dpkg -i ${{ runner.temp }}/hugo.deb          
      - name: 安装Dart Sass
        run: sudo snap install dart-sass
      - name: 检出
        uses: actions/checkout@v4 # 改成新版本
        with:
          submodules: recursive
          fetch-depth: 0
      - name: 设置Pages
        id: pages
        uses: actions/configure-pages@v3
      - name: 安装Node.js依赖
        run: "[[ -f package-lock.json || -f npm-shrinkwrap.json ]] && npm ci || true"
      - name: 使用Hugo构建
        env:
          # 为了与Hugo模块的最大向后兼容性
          HUGO_ENVIRONMENT: production
          HUGO_ENV: production
        run: |
          hugo \
            --gc \
            --minify \
            --baseURL "${{ steps.pages.outputs.base_url }}/"          
      - name: 上传构建产物
        uses: actions/upload-pages-artifact@v2 # 改成新版本
        with:
          path: ./public

  # 部署作业
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: 部署到GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v2 # 改成新版本
```

这里需要更改一些服务的版本，标在里面了，改完之后commit一下，如果没有报错就没什么问题了，访问url试一下，没什么问题就可以开始写文章了！

### 写文章

这个命令新建文章：

```bash
hugo new <dir/.md>
```

*不过我一般习惯把已有的文章复制过去清空写（*

对于blowfish，可以传入名为featured的图指定封面，background的图指定背景。

### 更新blowfish和hugo

hugo直接更新软件就行，仓库啥也不用改，workflow里配置的hugo版本记得也要改

更新blowfish，如果是像我一样按普通文件导入，那就需要自行下载源码覆盖了，记得不要把自己的自定义部分覆盖掉（