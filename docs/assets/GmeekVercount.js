function createBSZ() {
    var postBody = document.getElementById('postBody');
    if (postBody){
        postBody.insertAdjacentHTML('afterend','<div id="busuanzi_container_page_pv" style="float:left;margin-top:8px;font-size:small;">本文浏览量<span id="busuanzi_value_page_pv"></span>次</div>');
    }
    var runday = document.getElementById('runday');
    runday.insertAdjacentHTML('afterend', '<span id="busuanzi_container_site_pv">总浏览量<span id="busuanzi_value_site_pv"></span>次 • </span><span id="busuanzi_container_site_uv">访客<span id="busuanzi_value_site_uv"></span>位</span>');
    // 把 "Powered by Gmeek" 单独成行（与前面的统计信息分行）
    var footer = document.getElementById('footer2');
    if (footer) {
        var spans = footer.querySelectorAll('span');
        for (var i = 0; i < spans.length; i++) {
            if (/Powered by/.test(spans[i].textContent)) {
                spans[i].style.display = 'block';
                break;
            }
        }
    }
}

document.addEventListener("DOMContentLoaded", function() {
    createBSZ();
    var element = document.createElement('script');
    element.src = 'https://vercount.one/js';
    document.head.appendChild(element);
    console.log("\n %c GmeekBSZ Plugins https://github.com/Meekdai/Gmeek \n","padding:5px 0;background:#bc4c00;color:#fff");
});
