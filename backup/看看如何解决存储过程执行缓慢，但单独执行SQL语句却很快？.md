最近，在日常开发中发现了两个问题:
> 1. 应用程序调用存储过程很慢，但是在查询分析器中把SQL语句拿出来执行存储过程就很快。
>2. 在查询分析器中执行存储过程很慢，但是把存储过程中的内容拿出来执行很快

# 问题的分析与解决
## 问题1 产生原因

在应用程序中(或者在查询分析器中)调用存储过程的时候，存储过程的执行计划是被缓存了，就算参数不同，还是按照老的执行计划查询，效率也会不同。

## 问题1 解决方法

直接在存储过程定义参数的最后，添加**WITH RECOMPILE** 就会被强行重新编译执行存储过程。

如下图代码所示：
```
ALTER PROCEDURE PRO_NAME
(
   @PARA1 VARCHAR(100)
) WITH  RECOMPILE
```

**WITH RECOMPILE**确实可以强制重新编译执行计划，但会带来额外的编译开销，不适合频繁调用的存储过程。更好的做法是使用sp_recompile或更新统计信息。



在 SQL Server 中，`sp_recompile` 是一个系统存储过程，用于强制重新编译特定的存储过程、触发器或表的下一次执行。以下是具体使用方法和注意事项：



**注意事项**

1. 执行时机  
   • `sp_recompile` 本身不立即编译，仅标记对象在下一次执行时重新编译

   • 对性能关键对象，建议在低峰期执行


2. 与 `WITH RECOMPILE` 的区别  
   | 特性                | `sp_recompile`               | `WITH RECOMPILE`            |
   |---------------------|-----------------------------|----------------------------|
   | 作用范围            | 标记下次执行时重新编译       | 仅当前执行立即重新编译      |
   | 持久性              | 是（直到下次执行）           | 否（仅单次生效）            |
   | 性能影响            | 较小                        | 较大（每次执行都编译）      |

3. 替代方案  
   • 更新统计信息：`UPDATE STATISTICS 表名`

   • 清除计划缓存：`DBCC FREEPROCCACHE(plan_handle)`

4. 实际案例
```sql
-- 当订单表数据分布发生重大变化后：
-- (1) 更新统计信息
UPDATE STATISTICS Orders WITH FULLSCAN;

-- (2) 标记相关对象重编译
EXEC sp_recompile 'Orders';
EXEC sp_recompile 'usp_GetRecentOrders';
```

## 问题2 产生原因

在执行存储过程中出现了参数嗅探

## 问题2 解决方法

如果存储过程调用的比较频繁可使用 **OPTION (OPTIMIZE FOR UNKNOWN)** ，如果不是，可使用 **OPTION (RECOMPILE)** 。

因为业务需要，存储过程需要频繁使用，所以，使用了**OPTION (OPTIMIZE FOR UNKNOWN)** 处理。

具体使用代码示例如下：
```
ALTER PROCEDURE PRO_NAME
(
   @PARA1 VARCHAR(100)
) WITH  RECOMPILE
AS
BEGIN
   SELECT * FROM TABLE_NAME WHERE FIELD_NAME=@PARA1 OPTION (OPTIMIZE FOR UNKNOWN)
END
```
以上，亲测有效~

<!-- ##{"timestamp":1749082215}## -->
