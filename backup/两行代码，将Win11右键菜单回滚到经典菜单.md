现在，很多朋友的电脑都升级到最新的Windows11了，但是，Windows11的右键菜单，总让人看得怪怪的，很不舒服，今天，我将给大家介绍一个简单的方法，让大家的Windows11的右键菜单回归到经典菜单模式。


使用下面的代码，轻松回滚到Windows之前的经典菜单。

```
reg add "HKCU\Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\InprocServer32" /f /ve
```

直接拷贝上面的代码，右键点击开始菜单，运行终端管理员，拷贝代码，执行结果如下：

![Image](https://github.com/user-attachments/assets/9d5e6ce9-28f2-4697-ba9a-2992216d0709)

使用管理员模式运行CMD窗口，将下面的代码拷贝到CMD窗口并运行。

```
taskkill /f /im explorer.exe & start explorer.exe
```

![Image](https://github.com/user-attachments/assets/ba882fbe-03ca-4530-9e29-28cba0ee554a)

再次回车，回到资源管理器，点击任意文件或者文件夹，看效果：

![Image](https://github.com/user-attachments/assets/d93dba65-b72e-41f6-b92c-ff63c9291694)


至此，

两行代码，将Win11邮件菜单回滚到经典菜单模式。

如果你想回到之前Windows11菜单，可以使用下面的两行代码，轻松回到Windows11右键菜单样式。

```
reg delete "HKCU\Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}" /f
```

```
taskkill /f /im explorer.exe & start explorer.exe
```

#Windows11 #Development

![xBitBetter公众号](https://dotneteye.github.io/xbitbetter.png "xBitBetter公众号")
