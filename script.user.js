// ==UserScript==
// @name         nhentai helper
// @name:zh-CN   nhentai 助手
// @name:zh-TW   nhentai 助手
// @namespace    https://github.com/Tsuk1ko
// @version      2.2.0
// @icon         https://nhentai.net/favicon.ico
// @description        Add a "download zip" button for nhentai gallery page and some useful feature
// @description:zh-CN  为 nhentai 增加 zip 打包下载方式以及一些辅助功能
// @description:zh-TW  爲 nhentai 增加 zip 打包下載方式以及一些輔助功能
// @author       Jindai Kirin
// @include      https://nhentai.net/*
// @connect      i.nhentai.net
// @license      GPL-3.0
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_getResourceText
// @resource     notycss https://cdn.bootcss.com/noty/3.1.4/noty.css
// @require      https://cdn.bootcss.com/jquery/3.3.1/jquery.min.js
// @require      https://cdn.bootcss.com/jszip/3.1.4/jszip.min.js
// @require      https://cdn.bootcss.com/FileSaver.js/1.3.2/FileSaver.min.js
// @require      https://cdn.bootcss.com/jquery.pjax/2.0.1/jquery.pjax.min.js
// @require      https://cdn.bootcss.com/vue/2.6.10/vue.min.js
// @require      https://cdn.bootcss.com/noty/3.1.4/noty.min.js
// @run-at       document-end
// @noframes
// @homepageURL  https://github.com/Tsuk1ko/nhentai-helper
// @supportURL   https://github.com/Tsuk1ko/nhentai-helper/issues
// ==/UserScript==

(function() {
    'use strict';

    GM_addStyle(GM_getResourceText('notycss'));
    GM_addStyle(
        '.download-zip:disabled{cursor:wait}.gallery>.download-zip{position:absolute;z-index:1;left:0;top:0;opacity:.8}.gallery:hover>.download-zip{opacity:1}#download-panel::-webkit-scrollbar{width:6px;background-color:rgba(0,0,0,.7)}#download-panel::-webkit-scrollbar-thumb{background-color:rgba(255,255,255,.6)}#download-panel{position:fixed;top:20vh;right:0;width:200px;max-height:60vh;background-color:rgba(0,0,0,.7);z-index:100;font-size:12px;overflow-y:scroll}.download-item{white-space:nowrap;padding:2px}.download-item-title{overflow:hidden;text-overflow:ellipsis;text-align:left}.download-item-progress{background-color:rgba(0,0,255,.5);line-height:10px}.download-error .download-item-progress{background-color:rgba(255,0,0,.5)}.download-error{cursor:pointer}.download-item-progress-text{transform:scale(.8)}@media screen and (max-width:1200px){#download-panel{width:150px}}#page-container{position:relative}#gp-view-mode-btn{position:absolute;right:0;top:0;margin:0}.btn-noty-green{background-color:#66BB6A!important}.btn-noty-blue{background-color:#42A5F5!important}.btn-noty:hover{filter:brightness(1.15)}.noty_buttons{padding-top:0!important}'
    );

    $('body').append('<div id="download-panel"></div>');

    const EXT = { p: 'png', j: 'jpg', g: 'gif' };
    const getExtension = _t => {
        if (!EXT[_t]) throw new Error(`Unknown type "${_t}"`);
        return EXT[_t];
    };

    // 页面类型
    const pageType = {
        gallery: !!/^https:\/\/nhentai\.net\/g\/[0-9]+\/(\?.*)?$/.exec(window.location.href),
        galleryPage: !!/^https:\/\/nhentai\.net\/g\/[0-9]+\/[0-9]+\/(\?.*)?$/.exec(window.location.href),
        list: $('.gallery').length > 0,
    };

    // 下载队列
    const queue = [];
    const queueInfo = JSON.parse(sessionStorage.getItem('queueInfo')) || [];
    const downloadHistory = JSON.parse(localStorage.getItem('history')) || [];
    let running = false;
    const startQueue = async () => {
        if (!running && queue.length > 0) {
            running = true;
            do {
                await queue[0]();
                queue.shift();
            } while (queue.length > 0);
            running = false;
        }
    };

    // 下载面板
    Vue.component('download-item', {
        props: ['item'],
        computed: {
            width() {
                const { page, done } = this.item;
                return page && done ? ((100 * done) / page).toFixed(2) : 0;
            },
        },
        methods: {
            retry() {
                if (!this.item.error) return;
                this.item.error = false;
                running = false;
                startQueue();
            },
        },
        template: '<div :class="`download-item ${item.error?\'download-error\':\'\'}`" :title="item.title" @click="retry"><div class="download-item-title">{{item.title}}</div><div class="download-item-progress" :style="`width:${width}%`"><div class="download-item-progress-text"><templete v-if="item.error">click to retry</templete><templete v-else>{{width}}%</templete></div></div></div>',
    });
    Vue.component('download-list', {
        props: ['list'],
        template: '<div id="download-panel"><download-item v-for="item in list" :item="item" /></div>',
    });
    new Vue({
        el: '#download-panel',
        data: { queueInfo, downloadHistory },
        watch: {
            queueInfo(val) {
                sessionStorage.setItem('queueInfo', JSON.stringify(val));
            },
            downloadHistory(val) {
                sessionStorage.setItem('history', JSON.stringify(val));
            },
        },
        template: '<download-list :list="queueInfo" />',
    });

    // 网络请求
    const get = (url, responseType = 'json') =>
        new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                responseType,
                onerror: reject,
                onload: r => resolve(r.response),
            });
        });

    // 下载线程数
    let THREAD = GM_getValue('thread_num', 8);
    GM_registerMenuCommand('设置 nhentai 下载线程数', () => {
        let num;
        do {
            num = prompt(`请输入下载线程数 (1~32) [当前：${THREAD}]`, THREAD);
            if (num === null) return;
            num = parseInt(num);
        } while (num.toString() == 'NaN' || num < 1 || num > 32);
        THREAD = num;
        GM_setValue('thread_num', num);
    });

    // 伪多线程
    const multiThread = (tasks, promiseFunc) => {
        const threads = [];
        let taskIndex = 0;

        const run = threadID =>
            new Promise(async resolve => {
                while (true) {
                    let i = taskIndex++;
                    if (i >= tasks.length) break;
                    await promiseFunc(tasks[i], threadID);
                }
                resolve();
            });

        // 创建线程
        for (let threadID = 0; threadID < THREAD; threadID++) {
            threads.push(run(threadID));
        }
        return Promise.all(threads);
    };

    // 获取本子信息
    const getGallery = async gid => {
        const {
            media_id,
            title: { english, japanese },
            images: { pages },
        } = gid ? await get(`https://nhentai.net/api/gallery/${gid}`) : gallery;

        const p = [];
        pages.forEach((page, i) => {
            p.push({
                i: i + 1,
                t: getExtension(page.t),
            });
        });

        return {
            mid: media_id,
            title: japanese || english,
            pages: p,
        };
    };

    // 下载本子
    const downloadGallery = async ({ mid, title, pages }, $btn = null, $btnTxt = null, headTxt = '') => {
        const info = queueInfo[0] || {};
        info.done = 0;
        const zip = new JSZip();

        const btnUpdateProgress = () => {
            if (!$btnTxt) return;
            if (info.done >= pages.length) $btnTxt.html(`${headTxt}√`);
            else $btnTxt.html(`${headTxt}${info.done}/${pages.length}`);
        };

        btnUpdateProgress();

        const dlPromise = (page, threadID) => {
            if (info.error) return;
            const filename = `${page.i}.${page.t}`;
            const url = `https://i.nhentai.net/galleries/${mid}/${filename}`;
            console.log(`[${threadID}] ${url}`);
            return get(url, 'blob')
                .then(r => {
                    zip.file(filename, r);
                    info.done++;
                    btnUpdateProgress();
                })
                .catch(e => {
                    info.error = true;
                    throw e;
                });
        };

        await multiThread(pages, dlPromise);

        const data = await zip.generateAsync({
            type: 'blob',
            base64: true,
        });

        if ($btn) $btn.attr('disabled', false);
        queueInfo.shift();

        return {
            name: `${title}.zip`,
            data,
        };
    };
    const downloadG = async (gid, $btn = null, $btnTxt = null, headTxt = '') => downloadGallery(await getGallery(gid), $btn, $btnTxt, headTxt);

    // 语言过滤
    const langFilter = lang => {
        if (lang == 'none') $('.gallery').removeClass('hidden');
        else {
            $(`.gallery[lang=${lang}]`).removeClass('hidden');
            $(`.gallery:not([lang=${lang}])`).addClass('hidden');
        }
    };

    // 本子浏览模式
    const applyGPViewStyle = gpViewMode => {
        if (gpViewMode) $('body').append('<style id="gp-view-mode-style">#image-container img{width:auto;max-height:100vh}</style>');
        else $('#gp-view-mode-style').remove();
    };

    // 功能初始化
    const init = first => {
        if (first !== true) {
            $('.pagination a').each(function() {
                const $this = $(this);
                $this.attr('href', $this.attr('href').replace(/(&?)_pjax=[^&]*(&?)/, ''));
            });
            // pjax 后需要初始化页面以加载 lazyload 图片
            N.init();
        }

        if (pageType.gallery) {
            // 本子详情页
            $('#info > .buttons').append('<button class="btn btn-secondary download-zip"><i class="fa fa-download"></i> <span class="download-zip-txt">Download zip</span></button>');

            const $btn = $('.download-zip');
            const $btnTxt = $('.download-zip-txt');

            let zip;

            $btn.click(async () => {
                try {
                    if (!zip) {
                        $btn.attr('disabled', true);
                        zip = await downloadG(null, $btn, $btnTxt, 'Download zip ');
                    }
                    saveAs(zip.data, zip.name);
                } catch (error) {
                    $btnTxt.html('Error');
                    console.error(error);
                }
            });
        } else if (pageType.list) {
            // 本子列表页
            if (first === true) $('ul.menu.left').append('<li style="padding:0 10px">LANG filter: <select id="lang-filter"><option value="none">None</option><option value="zh">Chinese</option><option value="jp">Japanese</option><option value="en">English</option></select></li>');

            $('.gallery').each(function() {
                const $this = $(this);
                $this.prepend('<button class="btn btn-secondary download-zip"><i class="fa fa-download"></i> <span class="download-zip-txt"></span></button>');

                const $a = $this.find('a.cover');
                $a.attr('target', '_blank');
                const gid = /[0-9]+/.exec($a.attr('href'))[0];

                // 用于语言过滤
                let language = '';
                const dataTags = $this.attr('data-tags').split(' ');
                if (dataTags.includes('6346')) language = 'jp';
                else if (dataTags.includes('12227')) language = 'en';
                else if (dataTags.includes('29963')) language = 'zh';
                $this.attr('lang', language);

                const $btn = $this.find('.download-zip');
                const $btnTxt = $this.find('.download-zip-txt');

                $btn.click(async () => {
                    $btn.attr('disabled', true);
                    $btnTxt.html('Wait');
                    const gallery = await getGallery(gid);
                    if (downloadHistory.includes(gallery.title)) {
                        const abandon = new Promise(resolve => {
                            const n = new Noty({
                                type: 'error',
                                layout: 'bottomRight',
                                theme: 'nest',
                                text: `"${gallery.title}" is already downloaded or in queue.<br>Do you want to download again?`,
                                timeout: false,
                                closeWith: [],
                                buttons: [
                                    Noty.button('YES', 'btn btn-noty-green btn-noty', function() {
                                        resolve(false);
                                        n.close();
                                    }),
                                    Noty.button('NO', 'btn btn-noty-blue btn-noty', function() {
                                        resolve(true);
                                        n.close();
                                        $btn.attr('disabled', false);
                                        $btnTxt.html('');
                                    }),
                                ],
                            });
                            n.show();
                        });
                        if (await abandon) return;
                    } else downloadHistory.push(gallery.title);
                    queueInfo.push({
                        gid,
                        title: gallery.title,
                        page: gallery.pages.length,
                        done: 0,
                        error: false,
                    });
                    queue.push(async () => {
                        const { data, name } = await downloadGallery(gallery, $btn, $btnTxt);
                        saveAs(data, name);
                    });
                    startQueue();
                });
            });

            // 语言过滤
            if (first === true) {
                $('#lang-filter').change(function() {
                    langFilter(this.value);
                    sessionStorage.setItem('lang-filter', this.value);
                });
            }
            const rememberedLANG = sessionStorage.getItem('lang-filter');
            if (rememberedLANG) {
                $('#lang-filter')[0].value = rememberedLANG;
                langFilter(rememberedLANG);
            }

            // 还原下载队列
            if (first) {
                console.warn(1);
                for (const { gid } of queueInfo) {
                    queue.push(async () => {
                        const { data, name } = await downloadG(gid);
                        saveAs(data, name);
                    });
                }
            }
            startQueue();
        } else if (pageType.galleryPage) {
            // 本子在线阅读
            const gpViewModeText = ['[off]', '[on]'];
            let gpViewMode = GM_getValue('gp_view_mode', 0);
            applyGPViewStyle(gpViewMode);
            $('#page-container').prepend(`<button id="gp-view-mode-btn" class="btn btn-secondary"><i class="fa fa-arrows-v"></i> <span>100% view height</span> <span id="gp-view-mode-switch-text">${gpViewModeText[gpViewMode]}</span></button>`);
            const $gpvmst = $('#gp-view-mode-switch-text');
            $('#gp-view-mode-btn').click(() => {
                gpViewMode = 1 - gpViewMode;
                GM_setValue('gp_view_mode', gpViewMode);
                $gpvmst.html(gpViewModeText[gpViewMode]);
                applyGPViewStyle(gpViewMode);
            });
        }
    };

    $(document).pjax('.pagination a, .sort a', { container: '#content', fragment: '#content' });
    $(document).on('pjax:end', () => init());
    init(true);
})();
