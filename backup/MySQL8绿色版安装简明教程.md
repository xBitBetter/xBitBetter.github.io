# 背景

- 开发安装MySQL8版本，但是直接使用安装包安装，无法设置安装路径，mysql会直接安装到系统盘。不喜欢这样，所以选择MySQL8绿色版安装

# 下载地址

- 官网下载：https://dev.mysql.com/downloads/mysql/

![官网下载](https://github.com/user-attachments/assets/314402e2-b53e-4444-91dd-24d4a8fbe73c)

# 步骤

- 解压安装包
- 增加my.ini文件
     - my.ini是MySQL初始化配置文件，绿色版需要自己增加配置
     - 文件内容：（红色安装路径自己替换）
```
[mysql]
# 设置mysql客户端默认字符编码形式
default-character-set=utf8mb4

[mysqld]

#设置端口号，默认3306
port = 3306

# 设置mysql的安装目录
basedir=D:\mysql-8.0.19-winx64\
# 设置mysql数据库的数据存放目录
datadir=D:\mysql-8.0.19-winx64\data\
# 设置最大连接数
max_connections=200
# 允许连接失败的次数
max_connect_errors=10
# 服务端使用的字符集默认为utf8mb4
character-set-server=utf8mb4

# 创建新表时将使用的默认存储引擎
default-storage-engine=INNODB
# 默认使用“mysql_native_password”插件认证
#mysql_native_password
default_authentication_plugin=mysql_native_password
[client]

# 设置mysql客户端连接服务端时默认使用的端口
port=3306
default-character-set=utf8mb4
#initPass: Cet:m/ioh8Bq
```
- 初始化MySQL
    - 以管理员身份打开cmd
    - 进入MySQL安装目录下得bin文件夹
    - 执行初始化命令：mysqld --initialize --user=mysql --console
    - 这时在mysql安装目录将会生成一个data文件夹，用来存放数据    
![Image](https://github.com/user-attachments/assets/a4757769-25f9-4f4b-8ce3-50c67ae31c54)

    - 这时将会得到你的root初始密码，用来第一次登陆数据库，很重要，一旦丢失，只能重装。 如下图红框内即是初始密码    
![Image](https://github.com/user-attachments/assets/e4ca93cd-77f9-4004-9a2a-f39be2ca1b2c)

- 安装MySQL服务
    - 执行命令mysql --install，安装成功，如下图，同时也能在windows服务中看到mysql服务
![Image](https://github.com/user-attachments/assets/04d88e74-1a76-4339-bf9c-d8be0fa512ad)

 
- 启动MySQL
    - 执行命令：net start mysql
![Image](https://github.com/user-attachments/assets/fd1ce4bc-ec7a-4377-8fc2-69f7eecdbab5)

- 安装出现错误
    - 检查服务是否存在
![Image](https://github.com/user-attachments/assets/3c9a614f-8901-4d08-a82e-1474478df4c0)

    - 删除服务：sc delete mysql
    - 删除安装路径下生成的data文件夹
![Image](https://github.com/user-attachments/assets/066ce6c3-43ac-4033-b6bd-f466314f8ed1)
    - 重新安装

