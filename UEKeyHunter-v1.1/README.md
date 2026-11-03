# UEKeyHunter v1.1

通用 **UE4 / UE5 AES key 查找器**。不绑定任何游戏 —— 目标由你在运行时指定。

思路很简单：**拿 pak 索引做校验器**，把每个 32 字节候选喂进去解密，解出来的明文 SHA1 必须等于 pak 尾部 `FPakInfo` 里存的 `IndexHash`。这把是数学证明，不是"看着像"。

---

## 环境要求

- **Node.js **（只要这一个）。`run.bat` 会自动在 PATH、常见安装目录、`%USERPROFILE%\.dsh\dsh-runtimes\*` 里找；都不行就在工具目录新建 `node-path.txt`，写一行 node.exe 的完整路径。
- 抓内存那步用到 `powershell`（Windows 自带 5.1 就够）。

---

## 快速开始

```
双击 run.bat
  → 第一次会让你填游戏根目录（把文件夹拖进去也行）
  → 自动找到主程序 / *.pak / *.utoc / *.ucas 并写进 target.json
  → 然后从菜单里挑要干的事
```

命令行等价写法：

```
node setup.js "D:\Games\SomeGame"     # 自动发现并写 target.json
node setup.js --show                  # 看当前目标
node probe.js                         # 探测容器
node scan-file.js                     # 扫主程序找 key
node scan-file.js "D:\x\Other.dll"    # 扫任意文件
node verify-key.js <64位hex>          # 判定一把候选 key
powershell -File dump-mem.ps1 -ProcessName "Game-Win64-Shipping"
node scan-mem.js .\mem\Game-Win64-Shipping --fast --stride=8
node _selftest_oracle.js              # 校验器自检（改过代码先跑这个）
```

目标也可以在命令行临时覆盖，优先级最高：

```
node scan-file.js --game="D:\G\X" --pak="D:\G\X\Content\Paks\X.pak" "D:\G\X\X.exe"
```

---

## 文件说明

| 文件 | 作用 |
|---|---|
| `run.bat` | 菜单入口 |
| `setup.js` | 指定目标 + 自动发现 exe/pak/utoc/ucas，写 `target.json` |
| `config.js` | 读取目标（命令行 > target.json > 环境变量） |
| `probe.js` | 打印 pak 头部字段、utoc 头部字段、每 MB 可打印率/零字节率 |
| `scan-file.js` | 在任意文件里逐字节扫 key，命中即复核 |
| `dump-mem.ps1` | 转储进程内存（按区域分块写盘，默认跳过 <1MB 的碎片） |
| `scan-mem.js` | 扫转储目录（`--fast` 只用最强校验器，`--stride=N` 跳步） |
| `verify-key.js` | 手上已有候选 key 时直接判定真假 |
| `_selftest_oracle.js` | 校验器自检：埋一把已知 key，必须能捞回来 |
| `lib/aes256.js` | 纯 JS AES-256 单块解密，约 100 万 key/秒 |
| `lib/pak.js` | FPakInfo / FIoStoreTocHeader 解析（容忍非标准布局） |
| `lib/oracle.js` | 校验器构造、扫描主循环、整索引 SHA1 复核 |
| `target.example.json` | 配置样例 |

---

## 校验器怎么算出来的

UE4 的 `.pak` 尾部有一个 `FPakInfo`（magic `E1 12 6F 5A`），里面有 `IndexOffset / IndexSize / IndexHash`。索引被加密时，用正确 key 做 **AES-256-ECB** 解出 `IndexSize` 字节，其 SHA1 必然等于 `IndexHash`。

所以"0 命中"可以有底气说"这文件里真没有"，而不是"工具没扫到"。

同理，内存扫描的命中会立刻跑一遍整索引 SHA1 复核，写进 `hits.txt` 的只会是通过复核的。

---

## 常见问题（都是实测踩出来的）

1. **`failed to fill whole buffer`** —— 该 utoc/.pak 的 TOC 版本和工具预期不一致。先跑 `probe.js` 看 `version` 与 `flags`。
2. **`unrecognized subcommand 'extract'`** —— retoc 没有 `extract` 子命令，正确是 `retoc unpack <UTOC> <OUT>`，`--aes-key` 放子命令**前面**。
3. **AES_finder 说 `archives are probably not encrypted`** —— 它只扫 exe。key 可能只在运行时内存里出现（本工具实测遇到过一次完整案例，见 `docs/本机实测结论.md`）。
4. **抓内存抓到一堆零** —— 进程正在退出。必须游戏稳定跑到主菜单之后再抓，抓完用 `probe.js` 之外的字符串体检确认（活进程里必然有 `System32`、`kernel32` 之类）。
5. **`.ps1` 报 `The assignment expression is not valid`** —— 文件没 BOM 而里面有中文。PowerShell 5.1 会按 ANSI 解码。存成 **UTF-8 with BOM**。
6. **`VirtualQueryEx` 一直返回 0，`GetLastError()=24`** —— `dwLength` 要传结构体大小（x64 = 48），不是 `[IntPtr]::Size`。
7. **地址上限写成 `VirtualMemorySize64 + 0x100000000`** —— 64 位游戏内存能到 1TB+，会直接越界、静默返回 0 个区域。用 `0x7FFFFFFEFFFF`。
8. **`OutOfMemoryException`** —— 一次性 `New-Object byte[]` 几 GB 再切片会翻倍占用。改成 16MB 分块读、FileStream 直写。
9. **`.bat` 里 `!` 不展开 / 中文乱码** —— 存成 **GBK（代码页 936）+ CRLF**，首行 `chcp 936`，`echo` 文案里别带 `!`（延迟展开会吞）。
10. **`if` 块里出现 `)` 的提示文案** —— 括号会提前闭合 `if` 块，条件为假也照跑。
11. **FString 长度含结尾 `\0`** —— 判断挂载点时可打印字符数是 `len - 1`。这个 off-by-one 会让**正确 key 也判不是**，是最贵的坑。

---

## 输出

- `hits.txt` —— 命中记录，每行 `key \t 校验器 \t 来源`
- `target.json` —— 当前目标
- `mem\<进程名>\*.bin` —— 内存转储（扫完可以删，很占地方）

---

## 边界

这是本机容器解析工具，只做本地离线分析。key 是用来自己解自己游戏资源的，别拿它去搞别人服务器。
