同一个DbContext实例，EF会对查询过的数据进行缓存。对DbContext的生存期的管理需根据当前的应用来处理（如web、win），尽量不要采用全局的DbContext。也可在查询中采用AsNoTracking避免从缓存中取数据。

1、问题

构建一个全局的或某个业务场景内唯一的DbContext

```
public OTBll()
{
　　efContext = new AppDbContext();
　　this.OT_DataFlowRepository = new EFRepository<OT_DataFlow>(efContext);　
}
```
在此场景内间隔查询数据
```
HR_SignSealPdf entity =context.HR_SignSealPdf.FirstOrDefault(e =>
　　e.SignId == item.SignId && e.Cate == item.Cate);
entity.PdfUploadErrs += 1;
```

SSMS修改PdfUploadErrs后，仍会从entity.PdfUploadErrs的值上累加
```
UPDATE HR_SignSealPdf SET PdfUploadErrs=0
```

2、解决办法

（1）每次构建一个新的DbContext实例，使用完毕就释放

```
using (var context = new AppDbContext())
{
}
```

（2）AsNoTracking返回新的查询实体

```
efContext.HR_SignSealPdf.AsNoTracking()
```
反编译的代码

```
/// <summary>返回一个新查询，其中返回的实体将不会在 <see cref="T:System.Data.Entity.DbContext" /> 或 <see cref="T:System.Data.Entity.Core.Objects.ObjectContext" /> 中进行缓存。此方法通过调用基础查询对象的 AsNoTracking 方法来运行。如果基础查询对象没有 AsNoTracking 方法，则调用此方法将不会有任何影响。</summary>
    /// <returns>应用 NoTracking 的新查询，如果不支持 NoTracking，则为源查询。</returns>
    /// <param name="source">源查询。</param>
    public static IQueryable AsNoTracking(this IQueryable source)
    {
      System.Data.Entity.Utilities.Check.NotNull<IQueryable>(source, nameof (source));
      DbQuery dbQuery = source as DbQuery;
      if (dbQuery == null)
        return QueryableExtensions.CommonAsNoTracking<IQueryable>(source);
      return (IQueryable) dbQuery.AsNoTracking();
    }
```

3、优化

 web端可考虑在当前操作线程内定义个唯一的DbContext，以提高效率

```
//返回当前线程内的数据库上下文，如果当前线程内没有上下文，那么创建一个上下文，并保证上线问实例在线程内部是唯一的
public static VpoEntities GetCurrentDemoContext()
{
    //CallContext：是线程内部唯一的独用的数据槽（一块内存空间）
    //传递DbContext进去获取实例的信息，在这里进行强制转换。
    VpoEntities dbContext = CallContext.GetData("DbContext") as VpoEntities;
    if (dbContext == null) //线程在数据槽里面没有此上下文
    {
        dbContext = new VpoEntities(); //如果不存在上下文的话，创建一个EF上下文
        var adapter = (IObjectContextAdapter)dbContext;
        var objectContext = adapter.ObjectContext;
        objectContext.CommandTimeout = 1800;
 
        //我们在创建一个，放到数据槽中去
        CallContext.SetData("DbContext", dbContext);
    }
    return dbContext;
}
```

[原文地址](https://www.cnblogs.com/hepc/p/10253414.html)

![xBitBetter公众号](https://goohugo.github.io/xbitbetter.png "xBitBetter公众号")

<!-- ##{"timestamp":1748478669}## -->
