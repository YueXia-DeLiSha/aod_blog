// ============================================================
//  map-core.js  —  通用地图引擎
//  依赖：Leaflet (v1.9.4), Axios (必须提前加载)
//  暴露全局对象：window.MapApp
//  用法：MapApp.start({ dataUrl: '...', ... })
// ============================================================

(function(global) {
    'use strict';

    // -------- 默认配置 --------
    var defaults = {
        dataUrl: null,                // 必须提供，指向数据JSON
        mapCenter: [35.8617, 104.1954],
        mapZoom: 5,
        tileLayer: 'https://webrd02.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
        geoBaseUrl: 'https://blog.aodfans.com/json/',  // 存放GeoJSON的基础路径
        markerColor: '#3388ff',
        redMarkerColor: '#ff0000',
        // 可扩展其他配置
    };

    var config = {};
    var map, currentLayer, globalMarkers;
    var allMallsList = [];
    var mallDataByShortName = {};
    var isDrillDown = false;
    var currentProvinceFullName = '';
    var provincesListFull = [];
    var provinceCodeMap = {};
    var geoJsonCache = {};

    // -------- 工具函数 --------
    function getShortName(fullName) {
        if (fullName === '新疆维吾尔自治区') return '新疆';
        if (fullName === '广西壮族自治区') return '广西';
        if (fullName === '内蒙古自治区') return '内蒙古';
        if (fullName === '宁夏回族自治区') return '宁夏';
        if (fullName === '西藏自治区') return '西藏';
        return fullName.replace('省','').replace('自治区','').replace('市','');
    }

    // -------- 更新信息面板 --------
    function updateInfoPanel() {
        var redCount = allMallsList.filter(function(m) { return m.isRed; }).length;
        var normalCount = allMallsList.length - redCount;
        if (isDrillDown && currentProvinceFullName) {
            var short = getShortName(currentProvinceFullName);
            var count = mallDataByShortName[short] ? mallDataByShortName[short].length : 0;
            document.getElementById('infoPanel').innerHTML =
                '📍 当前省份: ' + currentProvinceFullName + ' | 商场/物料点总数: ' + count;
        } else {
            document.getElementById('infoPanel').innerHTML =
                '🏬 商场:' + normalCount + '  🔴物料点:' + redCount + ' | 点击省份下钻查看详情';
        }
    }

    // -------- 创建红色标记（物料点） --------
    function createRedMarker(lat, lng, popupContent) {
        return L.circleMarker([lat, lng], {
            radius: 8,
            fillColor: config.redMarkerColor,
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9
        }).bindPopup(popupContent);
    }

    // -------- 将标记置于顶层 --------
    function bringMarkersToFront() {
        if (globalMarkers) {
            map.removeLayer(globalMarkers);
            map.addLayer(globalMarkers);
        }
    }

    // -------- 初始化全局标记 --------
    function initGlobalMarkers() {
        if (globalMarkers) map.removeLayer(globalMarkers);
        var markerGroup = L.layerGroup();
        allMallsList.forEach(function(mall) {
            var popupContent = '<b>' + mall.name + '</b><br>📍 ' + mall.location +
                (mall.screens !== '0' ? '<br>🖥 屏幕: ' + mall.screens + '块 | ' + mall.tech : '') +
                (mall.lightTime ? '<br>⏰ 亮屏时间: ' + mall.lightTime : '') +
                (mall.days > 0 ? '<br>📅 播放天数: ' + mall.days + '天' : '') +
                (mall.rotation ? '<br>🔄 轮播频率: ' + mall.rotation : '') +
                (mall.isRed ? '<br><span style="color:#ff0000;">🔴 物料领取点</span>' : '');
            if (mall.isRed) {
                markerGroup.addLayer(createRedMarker(mall.lat, mall.lng, popupContent));
            } else {
                markerGroup.addLayer(L.marker([mall.lat, mall.lng]).bindPopup(popupContent, { maxWidth: 260 }));
            }
        });
        markerGroup.addTo(map);
        globalMarkers = markerGroup;
        updateInfoPanel();
    }

    // -------- 渲染省份GeoJSON（钻取） --------
    function renderProvinceGeoJson(geojson) {
        if (currentLayer) map.removeLayer(currentLayer);
        var provinceLayer = L.geoJSON(geojson, {
            style: { color: '#ff7800', weight: 2, fillColor: '#ffaa66', fillOpacity: 0.4 },
            onEachFeature: function(f, layer) {
                if (f.properties && f.properties.name) {
                    layer.bindTooltip(f.properties.name, { sticky: true });
                }
            }
        }).addTo(map);
        currentLayer = provinceLayer;
        bringMarkersToFront();
        map.fitBounds(provinceLayer.getBounds(), { padding: [20, 20] });
    }

    // -------- 下钻到某个省份 --------
    function focusOnProvince(fullName, adcode, shortName) {
        if (!adcode || adcode === '100000') return;
        var selfUrl = config.geoBaseUrl + adcode + '_full.json';
        var fallbackUrl = 'https://geo.datav.aliyun.com/areas_v3/bound/' + adcode + '_full.json';

        if (geoJsonCache[adcode]) {
            renderProvinceGeoJson(geoJsonCache[adcode]);
        } else {
            axios.get(selfUrl).then(function(res) {
                geoJsonCache[adcode] = res.data;
                renderProvinceGeoJson(res.data);
            }).catch(function() {
                axios.get(fallbackUrl).then(function(res2) {
                    geoJsonCache[adcode] = res2.data;
                    renderProvinceGeoJson(res2.data);
                }).catch(function() {
                    alert('无法加载该省份详细地图');
                });
            });
        }
        isDrillDown = true;
        currentProvinceFullName = fullName;
        document.getElementById('backButton').style.display = 'block';
        updateInfoPanel();
    }

    // -------- 返回全国地图 --------
    function resetToChina() {
        if (currentLayer) map.removeLayer(currentLayer);
        currentLayer = null;
        loadChinaGeoJson();
        isDrillDown = false;
        currentProvinceFullName = '';
        document.getElementById('backButton').style.display = 'none';
        updateInfoPanel();
    }

    // -------- 加载全国GeoJSON --------
    function loadChinaGeoJson() {
        var selfHosted = config.geoBaseUrl + '100000_full.json';
        var fallback = 'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json';

        if (geoJsonCache['100000']) {
            renderChinaMap(geoJsonCache['100000']);
            if (provincesListFull.length === 0) {
                provincesListFull = generateProvinceList(geoJsonCache['100000']);
                buildSidebarAndBottom(provincesListFull);
            }
        } else {
            axios.get(selfHosted).then(function(res) {
                geoJsonCache['100000'] = res.data;
                renderChinaMap(res.data);
                provincesListFull = generateProvinceList(res.data);
                buildSidebarAndBottom(provincesListFull);
            }).catch(function() {
                axios.get(fallback).then(function(res2) {
                    geoJsonCache['100000'] = res2.data;
                    renderChinaMap(res2.data);
                    provincesListFull = generateProvinceList(res2.data);
                    buildSidebarAndBottom(provincesListFull);
                }).catch(function() {
                    document.getElementById('infoPanel').innerHTML = '地图数据加载失败，请检查网络';
                });
            });
        }
    }

    // -------- 渲染全国地图 --------
    function renderChinaMap(geojson) {
        if (currentLayer) map.removeLayer(currentLayer);
        var chinaLayer = L.geoJSON(geojson, {
            style: { color: '#3388ff', weight: 1.5, fillColor: '#c3e0ff', fillOpacity: 0.4 },
            onEachFeature: function(feature, layer) {
                var fullName = feature.properties.name;
                var adcode = feature.properties.adcode;
                if (fullName && adcode && adcode !== '100000') {
                    var short = getShortName(fullName);
                    layer.bindTooltip(fullName, { sticky: true });
                    layer.on('click', function() {
                        focusOnProvince(fullName, adcode, short);
                    });
                }
            }
        }).addTo(map);
        currentLayer = chinaLayer;
        bringMarkersToFront();
        if (!isDrillDown) {
            map.setView(config.mapCenter, config.mapZoom);
        }
    }

    // -------- 生成省份列表（从GeoJSON） --------
    function generateProvinceList(geojson) {
        var provinces = [];
        geojson.features.forEach(function(f) {
            var full = f.properties.name;
            var adcode = f.properties.adcode;
            if (full && adcode && adcode !== '100000') {
                var short = getShortName(full);
                provinces.push({ fullName: full, shortName: short, adcode: adcode });
                provinceCodeMap[full] = adcode;
            }
        });
        provinces.sort(function(a, b) {
            return a.fullName.localeCompare(b.fullName, 'zh');
        });
        return provinces;
    }

    // -------- 构建侧边栏和底部卡片 --------
    function buildSidebarAndBottom(provinces) {
        var sidebar = document.getElementById('provinceSidebar');
        var bottomDiv = document.getElementById('bottomProvinceList');
        sidebar.innerHTML = '';
        bottomDiv.innerHTML = '';

        if (!provinces.length) {
            sidebar.innerHTML = '<div style="padding:8px; text-align:center;">暂无数据</div>';
            bottomDiv.innerHTML = '<div style="padding:8px; text-align:center;">暂无数据</div>';
            return;
        }

        // 侧边栏（按字母分组）
        var groups = {};
        provinces.forEach(function(p) {
            var first = p.fullName.charAt(0);
            if (!groups[first]) groups[first] = [];
            groups[first].push(p);
        });
        Object.keys(groups).sort().forEach(function(letter) {
            var letterDiv = document.createElement('div');
            letterDiv.className = 'sidebar-letter';
            letterDiv.innerText = letter;
            sidebar.appendChild(letterDiv);
            groups[letter].forEach(function(prov) {
                var provDiv = document.createElement('div');
                provDiv.innerText = prov.fullName;
                provDiv.onclick = function() {
                    focusOnProvince(prov.fullName, prov.adcode, prov.shortName);
                };
                sidebar.appendChild(provDiv);
            });
        });

        // 底部卡片
        provinces.forEach(function(prov) {
            var count = mallDataByShortName[prov.shortName] ? mallDataByShortName[prov.shortName].length : 0;
            var card = document.createElement('div');
            card.className = 'province-card';
            card.innerHTML = '<div class="province-name">' + prov.fullName + '</div><div class="mall-count">🏬 ' + count + ' 个点</div>';
            card.onclick = function() {
                focusOnProvince(prov.fullName, prov.adcode, prov.shortName);
            };
            bottomDiv.appendChild(card);
        });
    }

    // -------- 设置搜索功能 --------
    function setupSearch() {
        var searchInput = document.getElementById('searchInput');
        var suggestionsDiv = document.getElementById('suggestions');

        function updateSuggestions(keyword) {
            var kw = keyword.trim().toLowerCase();
            if (!kw) {
                suggestionsDiv.style.display = 'none';
                return;
            }
            var matchedProvinces = provincesListFull.filter(function(p) {
                return p.fullName.toLowerCase().includes(kw) || p.shortName.toLowerCase().includes(kw);
            });
            var matchedMalls = allMallsList.filter(function(m) {
                return m.name.toLowerCase().includes(kw);
            });
            var container = document.createElement('div');
            if (matchedProvinces.length) {
                var header1 = document.createElement('div');
                header1.innerText = '省份';
                header1.style.fontWeight = 'bold';
                header1.style.backgroundColor = '#f0f0f0';
                container.appendChild(header1);
                matchedProvinces.forEach(function(p) {
                    var item = document.createElement('div');
                    item.innerText = '🗺️ ' + p.fullName;
                    item.onclick = function() {
                        searchInput.value = p.fullName;
                        suggestionsDiv.style.display = 'none';
                        focusOnProvince(p.fullName, p.adcode, p.shortName);
                    };
                    container.appendChild(item);
                });
            }
            if (matchedMalls.length) {
                var header2 = document.createElement('div');
                header2.innerText = '商场/物料点';
                header2.style.fontWeight = 'bold';
                header2.style.backgroundColor = '#f0f0f0';
                container.appendChild(header2);
                matchedMalls.forEach(function(m) {
                    var shortProv = m.province;
                    var fullProvEntry = provincesListFull.find(function(p) { return p.shortName === shortProv; });
                    var fullProvName = fullProvEntry ? fullProvEntry.fullName : shortProv;
                    var adcode = fullProvEntry ? fullProvEntry.adcode : provinceCodeMap[fullProvName];
                    var prefix = m.isRed ? '🔴 ' : '🏬 ';
                    var item = document.createElement('div');
                    item.innerText = prefix + m.name + ' (' + shortProv + ')';
                    item.onclick = function() {
                        searchInput.value = m.name;
                        suggestionsDiv.style.display = 'none';
                        if (fullProvEntry) {
                            focusOnProvince(fullProvName, adcode, shortProv);
                        } else {
                            alert('省份信息缺失');
                        }
                        setTimeout(function() {
                            if (globalMarkers) {
                                var opened = false;
                                globalMarkers.eachLayer(function(layer) {
                                    if (layer.getPopup && layer.getPopup().getContent().includes(m.name)) {
                                        layer.openPopup();
                                        opened = true;
                                    }
                                });
                                if (!opened) alert('标记已在图上，请缩放查看');
                            }
                        }, 500);
                    };
                    container.appendChild(item);
                });
            }
            if (matchedProvinces.length === 0 && matchedMalls.length === 0) {
                var empty = document.createElement('div');
                empty.innerText = '无匹配结果';
                container.appendChild(empty);
            }
            suggestionsDiv.innerHTML = '';
            suggestionsDiv.appendChild(container);
            suggestionsDiv.style.display = 'block';
        }

        searchInput.addEventListener('input', function(e) {
            updateSuggestions(e.target.value);
        });

        document.getElementById('searchBtn').addEventListener('click', function() {
            var kw = searchInput.value.trim();
            if (!kw) return;
            var prov = provincesListFull.find(function(p) {
                return p.fullName === kw || p.shortName === kw;
            });
            if (prov) {
                focusOnProvince(prov.fullName, prov.adcode, prov.shortName);
                suggestionsDiv.style.display = 'none';
                return;
            }
            var mall = allMallsList.find(function(m) { return m.name === kw; });
            if (mall) {
                var shortProv = mall.province;
                var fullProv = provincesListFull.find(function(p) { return p.shortName === shortProv; });
                if (fullProv) focusOnProvince(fullProv.fullName, fullProv.adcode, shortProv);
                setTimeout(function() {
                    if (globalMarkers) {
                        globalMarkers.eachLayer(function(layer) {
                            if (layer.getPopup && layer.getPopup().getContent().includes(mall.name)) {
                                layer.openPopup();
                            }
                        });
                    }
                }, 500);
                suggestionsDiv.style.display = 'none';
                return;
            }
            alert('未找到匹配的省份或点');
        });

        document.addEventListener('click', function(e) {
            if (!searchInput.contains(e.target) && !suggestionsDiv.contains(e.target)) {
                suggestionsDiv.style.display = 'none';
            }
        });
    }

    // -------- 启动函数（对外暴露） --------
    function start(userConfig) {
        if (!userConfig || !userConfig.dataUrl) {
            console.error('MapApp.start: 必须提供 dataUrl 配置项');
            return;
        }
        config = Object.assign({}, defaults, userConfig);

        // 初始化地图
        map = L.map('map').setView(config.mapCenter, config.mapZoom);
        L.tileLayer(config.tileLayer,{
        attribution: '&copy; <a href="https://www.amap.com/">高德地图</a>'}).addTo(map);

        // 加载数据
        fetch(config.dataUrl)
            .then(function(res) { return res.json(); })
            .then(function(data) {
                allMallsList = data;
                // 重建 mallDataByShortName
                mallDataByShortName = {};
                allMallsList.forEach(function(mall) {
                    if (!mallDataByShortName[mall.province]) mallDataByShortName[mall.province] = [];
                    mallDataByShortName[mall.province].push(mall);
                });
                // 初始化标记
                initGlobalMarkers();
                // 加载全国地图
                loadChinaGeoJson();
                // 搜索
                setupSearch();
                // 返回按钮
                document.getElementById('backButton').addEventListener('click', resetToChina);
                // 更新信息面板
                updateInfoPanel();
            })
            .catch(function(err) {
                console.error('数据加载失败', err);
                document.getElementById('infoPanel').innerHTML = '❌ 数据加载失败，请刷新重试';
            });
    }

    // -------- 暴露公共 API --------
    global.MapApp = {
        start: start
    };

})(window);