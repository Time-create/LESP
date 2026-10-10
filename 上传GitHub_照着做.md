# 上传 GitHub：照着做即可

> 我已把所有前置工作做完**并用 git 自己的命令实测验证过**。你只剩 5 步，约 10 分钟。
>
> 完整审计报告见对话记录；本文件是最终可执行清单。

---

## 当前状态（已就绪并验证）

| 项目 | 状态 |
|---|---|
| `.gitignore` | ✅ 实测拦截：335 个文件里敏感项 **0** |
| `.gitattributes` | ✅ 已配好（统一 LF，避免将来 300+ 文件被误标"已修改"）|
| 仓库 | ✅ 已 `git init`，335 个文件已暂存，**提交历史干净（0 条）** |
| git 身份 | ⬜ **未配置** —— 见第 1 步 |
| 远程仓库 | ⬜ **待你创建** |

### 实测核验结果（用 `git show` 与 `git grep` 查提交内容本身）

```
提交文件数：335
敏感目录 data/dist/node_modules/.workbuddy/.desktop-smoke/.v2-safety → 0
敏感文件 PDF 0   数据库 0   zip 0   .py 0
本机用户名 → 0 处
```

### ⚠️ 会卡住你的地方

git **没有配置身份信息**，直接 `git commit` 会报 `Author identity unknown`。
所以第 1 步是配置它 —— **不能跳过**。

---

## 第 1 步：配置 git 身份

打开终端（`Win+R` → 输入 `cmd` → 回车），**逐行粘贴执行**：

```bash
cd /d "D:/Application/LESP · 辑微"
git config user.name "你的名字"
git config user.email "你的邮箱@example.com"
```

**填什么邮箱？**

- 推荐：与你的 GitHub 账号邮箱**一致**（Settings → Emails 里能看到）
- 只上传不上传都行，本项目是私有仓库
- 怕暴露就用 `你的昵称@users.noreply.github.com`

验证：
```bash
git config user.name
git config user.email
```

---

## 第 2 步：在 GitHub 创建**私有**仓库

1. 打开 <https://github.com/new>
2. **Repository name**：填 `leshi-workbench`（或你喜欢的名字）
3. **Owner**：选你的账号
4. ⚠️ **Visibility 必须选 Private**
5. ❗ **不要勾选** "Add a README file"
6. ❗ **不要勾选** "Add .gitignore"
7. ❗ **不要勾选** "Choose a license"
8. 点 **Create repository**

---

## 第 3 步：提交

在第 1 步那个终端里执行：

```bash
git commit -m "init: LESP 辑微工作台"
```

看到 `[main (root-commit) xxxxx]` 之类的输出就成功了。

---

## 第 4 步：连接远程并推送

**创建完仓库后GitHub 会直接给你一段命令**，直接复制粘贴最省事。它长这样：

```bash
git remote add origin https://github.com/你的用户名/leshi-workbench.git
git branch -M main
git push -u origin main
```

> 如果让我猜（你还没建仓库）：把 `你的用户名` 换成你的 GitHub 用户名。

**推送时可能要求登录**：弹出窗口让你输 GitHub 用户名 + 密码。
⚠️ **密码位置要填 Personal Access Token，不是账户密码**（GitHub 2021 年起已禁用密码推送）。

**拿 Token 的方法**：GitHub → 头像 → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token
- 勾选 `repo` 就够了
- 有效期设 90 天
- 生成后复制那串 `ghp_...`，粘贴到密码位置（**只显示一次，务必先复制**）

---

## 第 5 步：开启两步验证（强烈建议）

**GitHub → 头像 → Settings → Password and authentication → Two-factor authentication**

仓库是私密的，但账号被盗数据一样会沦陷。这一步花 2 分钟。

---

## 上传后自检

打开仓库页面，逐项确认：

- [ ] 顶部显示 **Private**
- [ ] 文件列表里**没有** `data`、`dist`、`node_modules` 目录
- [ ] 搜不到 `.pdf`、`.db` 文件
- [ ] 搜本机用户名（`C:\Users\` 下那一段）→ **0 结果**
- [ ] `server/`、`public/`、`tests/` 都在（说明代码完整）

---

## 遇到问题怎么办

| 报错 | 原因与解法 |
|---|---|
| `Author identity unknown` | 没配身份 → 回第 1 步 |
| `remote origin already exists` | 已经连过了 → `git remote set-url origin <新地址>` |
| `Authentication failed` | Token 没填对 → 重新生成，注意粘贴的是 Token 不是密码 |
| `403 Forbidden` | 仓库名或用户名拼错；或仓库不是 Private 却要权限 |
| `failed to push some refs` | 通常是远程已有提交 → `git pull --rebase origin main` 后再 push |
| `The requested URL returned error: 403` | 开了两步验证但没用 App password → 用 Token |

**最稳妥的做法**：在 GitHub 创建仓库页面，直接复制它给的命令 —— 那几行是针对你的仓库生成的，不会出错。

---

## 命令速查（想跳过讲解就照这个走）

```bash
cd /d "D:/Application/LESP · 辑微"
git config user.name "你的名字"
git config user.email "你的邮箱@example.com"
git commit -m "init: LESP 辑微工作台"
git remote add origin https://github.com/你的用户名/leshi-workbench.git
git branch -M main
git push -u origin main
```

---

## 重要提醒

**一旦推上去，`data/` 里的数据永远不会进入仓库** —— `.gitignore` 已实测拦截。
但如果将来你**新增**了什么含敏感信息的文件，记得它同样会被拦；反过来，若删掉 `.gitignore` 再提交，
那些文件就会进历史里且难以彻底清除。

保持 `.gitignore` 在位即可。

---

*步骤更新：2026-10-10。提交内容 335 个文件（含 .gitattributes），敏感文件与用户名均已核验为 0。*