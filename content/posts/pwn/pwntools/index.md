+++
date = '2025-12-06T17:00:00+08:00'
draft = false
title = 'Python Pwntools的基础使用方法'
+++

大概一个半月之前，我打算开始学pwn，那时我还是啥都不知道的小菜。花了半天时间配了个WSL，找了一堆视频和文章，有的上来开始讲ELF，有的上来开始讲栈溢出，虽然这些在pwn中确实很基础，但我看了半天感觉确实也很离谱。

**全  都  看  不  懂  ！**

![ALL_FxxKING_SUCK(nope)](/resource/img1.png)

后来找了个大佬求带，大佬当时只给我讲了一个题，那道题不需要各种漏洞，只需要做一个“简单的口算”，在限定时间内求出两个几千左右的随机数的积，我顿感震惊：这就是最基础的二进制安全吗？防止开挂破坏玩家生态？？

所以说，作为学了一个月还是没有啥成就的小菜，要来写（shui）第一篇blog，还必须要有干货，写什么？那就写python pwntools怎么用，如何写一个神奇的口算脚本！

## 基础使用方法

首先导入pwntools：

```python
from pwn import *
```

我们的主要目的是连接程序进行交互，但是建立连接之前，咱们也可以进行一些设置。

### 设置context

这里可以设置一些背景信息。你可以告诉脚本使用的架构，操作系统，日志详细程度等详细信息，一般情况下是可以不设置的，但是设置了可能方便某些模块的使用，或者获得更详细的调试信息。

```python
# 可以这样
context(xx = "xx", yy = "yy")
# 也可以这样
context.xx = "xx"
context.yy = "yy"

# 具体设置的参数：
context.arch = "amd64"  # 架构，有i386，amd64等
context.os = "linux"  # 操作系统，一般都是linux
context.log_level = "debug"  # 日志详细程度，选择debug之后每次接收或者发送都有详细的日志
```

### 设置目标libc，ELF

你可以设置ELF和libc，这样可以让脚本帮你找一些gadgets的位置，比如标准库函数的偏移地址。

```python
xx = ELF("./xx")  #指定一个ELF

# 接下来你就可以对这个ELF做一些操作，比如：
system_offset = xx.symbols['system'] # 找一些函数的地址，如果开了地址随机化就是偏移地址
binsh_offset = xx.search(b"/bin/sh") # 搜一些字符串的地址，开了随机化同上
puts_got = xx.got['puts'] # 找一个函数的got表地址，同上
puts_plt = xx.plt['puts'] # 找一个函数的plt表地址，同上

xx.address = 0x114514 # 设置这个ELF的基址，之后搜索到的地址都是加上基址之后的实际地址
```

### 启动程序

接下来就可以启动程序，开始操作了。

```python
xx = process("./xx") # 开一个本地程序
xx = connect("0.0.0.0", 11111) # 连接一个在线环境

gdb.attach(xx) # gdb附加调试
gdb.attach(xx, '''
    b 0x114514
    continue
''') # 还能顺带给gdb发点指令！
```

### 基础交互

你可以对程序做一些交互，比如发送和接收。

```python
# 接收
xx.recv(n) # 收n个字节
xx.recvline() # 收一行
xx.recvuntil(b'xx') # 收到xx为止
xx.recvall() # 一直收

a = xx.recv(114514) # 还能把收到的字符串赋给a！
a = xx.recv(16).strip() # 移除两端的空白字符
a = int(xx.recv(16), 10) # 如果收到的字符串像个数字，可以把他按特定进制转换成整数

xx.clean() # 还能把收到的扔了！



# 发送
xx.send(b'xx') # 发送xx，不带回车
xx.sendline(b'xx') # 带回车
xx.sendafter(b'xx', b'yy') # 收到xx后发yy，不带回车
xx.sendlineafter(b'xx', b'yy') # 收到xx后发yy，带回车

payload = b'xx' + b'yy'
xx.send(payload) # 构造好了再发

payload = cyclic(100)
xx.send(payload) # 发垃圾

payload = p32(0x64636261, endian = 'little') # 以指定字节序将整数打包为特定位数的字节串，不足高位补0
# payload = b'abcd'
payload = u32(b'abcd', endian = 'little') # 以指定字节序将字节串解包为特定位数的整数，长度必须为32bits
# payload = 0x64636261

a = 114514
xx.send(str(a).encode()) # 将数字转化为字符串编码输出，注意要用encode编码，不编码默认用ascii编码，可能发送的不是你想发送的东西



# 其他
a = 2
log.info("xx") # 可以添加一些醒目的调试信息
log.success("a = " + str(a)) # 成功信息，注意后面加的只能是字符串
# 还有警告warn，错误error，等待waitfor等信息

xx.interactive() # 由你亲自上阵进行交互！一般用来验证是否成功getshell，或者拿flag
```

## 实战演练

现在我们就来尝试做一个口算脚本！

例题：极客大挑战2024 - 简单的签到

拿到文件，拖入ida，主要的函数如下：

```c
int math1()
{
  unsigned int v0; // eax
  int v2; // [rsp+10h] [rbp-10h]
  int v3; // [rsp+14h] [rbp-Ch]

  v0 = time(0LL);
  srand(v0);
  v3 = rand() % 10000 + 1;
  v2 = rand() % 10000 + 1;
  printf("%d * %d = ", v3, v2);
  if ( (unsigned int)get_input_with_timeout() != v2 * v3 )
  {
    printf("Incorrect. The correct answer was %d. Exiting...\n", v2 * v3);
    exit(1);
  }
  puts("Correct! Opening shell...");
  return system("/bin/sh");
}
```

这个函数会随机两个一万以内的数，要求你在限定时间内输入这两个数的积。

我们只要收到数字然后相乘就可以了，但是他发送的是一个乘法，不是单纯的两个数字，如何去掉其他字符呢？

这时就可以用上面提到的`recvuntil`和`strip`了！

写好的payload如下：
```python
from pwn import *
# 我们也可以设置context的，但是这里不需要设置，懒了（跪
io = process("./main")

io.recvuntil(b'challenge.') # 接收欢迎信息
io.send(b'\n') # 按任意键继续

a = int(io.recvuntil(b' ').strip()) # 收到乘号前面的空格为止，去除空白
log.success("a = " + str(a))
io.recvuntil(b'* ') # 把等号和后面的空格收了
b = int(io.recvuntil(b' ').strip()) # 收到等号前面的空格为止，去除空白
log.success("b = " + str(b))

r = a * b # 计算
log.success("a * b = " + str(r))

io.recvuntil(b'= ') # 把等号和后面的空格收了
io.sendline(str(r).encode()) # 编码输出

io.interactive() # 开启交互模式
```

先给拿到的附件里的ELF程序加上可执行权限，让脚本能打开程序，运行脚本。

```bash
chmod +x main
python3 1.python
```

等进入交互模式后，你就可以验证自己有没有成功getshell了。

```bash
# 本地可以用这个
whoami # 发送用户名

# 远程可以用这个
ls # 看看当前目录中的东西
cat flag # 如果有flag，直接读取
```

最后大概就是这样：
```terminal
[+] Starting local process './main': pid 8358
[+] a = 9307
[+] b = 1667
[+] a * b = 15514769
[*] Switching to interactive mode
Correct! Opening shell...
$ whoami
kioroshiaki
```

## 后记

看完这个脚本，你会发现前面好多内容完全看不懂/用不到？！

确实是这样，不过这是为了水blog啊（被打

不过这是为了熟悉pwntools的一些知识，方便后面写脚本！这些都是常用的一些内容！即使现在看不懂/用不到，随着进一步的学习，迟早会用到的！

第一篇blog就是这样，终于水完了（逃