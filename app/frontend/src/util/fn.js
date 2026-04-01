export function clone(e) {
  return JSON.parse(JSON.stringify(e));
}

export const formatDt = (d, t) => {
  d = d.replaceAll("-", "");
  t = t.replaceAll(":", "");
  return parseInt(`${d}${t}`);
};

export const decodeDt = (d) => {
  let date = d.toString();
  date = date.length > 12 ? date.substr(0, 12) : date;
  date = `${date.substr(2, 2)}-${date.substr(4, 2)}-${date.substr(6, 2)} ${date.substr(8, 2)}:${date.substr(10, 2)}`;
  return date;
};

export const max = (arr) => {
  if (arr.length === 0) {
    return null;
  }
  return Math.max(...arr);
};

export const isN = (e) => {
  return e === null || e === "" || e === undefined ? true : false;
};

export const isMobile = () => {
  return document.querySelector("html").clientWidth < 1000;
};

export const fix = (str, acc = 1) => {
  const num = parseFloat(str);
  if (isNaN(num)) {
    return "";
  }
  const ret = parseFloat(num.toFixed(acc));
  return ret;
};

export const msg = (info) => {
  notification.info({
    message: "提示",
    description: info,
    placement: "topLeft",
    style: {
      width: 300,
      color: "#ff0000",
      background: "rgba(255,255,255,.9)"
    }
  });
};

// ======= 配置常量 =======
const MAX_ASPECT_RATIO = 2; // 最大允许长宽比
const BOUNDARY_RANGE = 0.1; // 边界过滤范围 10%
const MAX_AREA_RATIO = 0.9; // 最大允许面积比例
const MIN_AREA_RATIO = 0.1; // 最小允许面积比例

// ======= 配置开关 =======
const FILTER_CONFIG = {
  removeOverlap: false,
  boundaryFilter: true,
  areaExtremesFilter: true,
  aspectRatioFilter: true
};

export const filterYoloObjects = (objects, config = FILTER_CONFIG) => {
  if (!objects || objects.length === 0) return [];

  // 合并默认配置和传入配置
  const cfg = { ...FILTER_CONFIG, ...config };

  // 1. 计算宽、高、面积
  const withArea = objects.map((obj) => {
    const width = obj.x2 - obj.x1;
    const height = obj.y2 - obj.y1;
    const area = width * height;
    return { ...obj, width, height, area };
  });

  // ====== 计算最大 & 最小面积 ======
  const areas = withArea.map((o) => o.area);
  const maxArea = Math.max(...areas);
  const minArea = Math.min(...areas);

  console.log("最大面积:", maxArea);
  console.log("最小面积:", minArea);

  // 最终结果数组
  let result = [...withArea];

  // =====================================================
  // 2. 去掉重叠目标（可开关）
  // =====================================================
  if (cfg.removeOverlap) {
    function iou(a, b) {
      const xLeft = Math.max(a.x1, b.x1);
      const yTop = Math.max(a.y1, b.y1);
      const xRight = Math.min(a.x2, b.x2);
      const yBottom = Math.min(a.y2, b.y2);

      if (xRight <= xLeft || yBottom <= yTop) return 0;

      const intersection = (xRight - xLeft) * (yBottom - yTop);
      const union = a.area + b.area - intersection;
      return union === 0 ? 0 : intersection / union;
    }

    const sorted = [...result].sort((a, b) => b.area - a.area);
    const keep = [];

    for (let i = 0; i < sorted.length; i++) {
      const curr = sorted[i];
      const overlap = keep.some((k) => iou(curr, k) > 0);
      if (!overlap) keep.push(curr);
    }

    result = keep;
  }

  // =====================================================
  // 3. 边界过滤（可开关）
  // =====================================================
  if (cfg.boundaryFilter) {
    const maxX = Math.max(...withArea.map((o) => o.x2));
    const maxY = Math.max(...withArea.map((o) => o.y2));

    result = result.filter(
      (o) =>
        o.x1 >= BOUNDARY_RANGE * maxX &&
        o.x2 <= (1 - BOUNDARY_RANGE) * maxX &&
        o.y1 >= BOUNDARY_RANGE * maxY &&
        o.y2 <= (1 - BOUNDARY_RANGE) * maxY
    );
  }

  // =====================================================
  // 4. 去掉面积最大值 ±10% & 最小值 ±10%（可开关）
  // =====================================================
  if (cfg.areaExtremesFilter) {
    result = result.filter(
      (o) =>
        o.area < maxArea * MAX_AREA_RATIO && // 去掉接近最大面积
        o.area > minArea * MIN_AREA_RATIO // 去掉接近最小面积
    );
  }

  // =====================================================
  // 5. 去掉长宽比超过 MAX_ASPECT_RATIO（可开关）
  // =====================================================
  if (cfg.aspectRatioFilter) {
    result = result.filter((o) => {
      const ratio = Math.max(o.width, o.height) / Math.min(o.width, o.height);
      return ratio <= MAX_ASPECT_RATIO;
    });
  }

  return result;
};

/** 计算单个标注的面积 */
export const calcRectArea = (rect) => {
  const width = rect.x2 - rect.x1;
  const height = rect.y2 - rect.y1;
  return width * height;
};

/** 计算两个矩形的重叠面积 */
export const calcOverlapArea = (a, b) => {
  // 重叠区域的左边界：取两个矩形左边界的最大值
  const overlapX1 = Math.max(a.x1, b.x1);
  // 重叠区域的右边界：取两个矩形右边界的最小值
  const overlapX2 = Math.min(a.x2, b.x2);
  // 重叠区域的上边界：取两个矩形上边界的最大值
  const overlapY1 = Math.max(a.y1, b.y1);
  // 重叠区域的下边界：取两个矩形下边界的最小值
  const overlapY2 = Math.min(a.y2, b.y2);

  // 若没有重叠，返回0
  if (overlapX1 >= overlapX2 || overlapY1 >= overlapY2) return 0;

  // 重叠面积 = 重叠宽度 * 重叠高度
  return (overlapX2 - overlapX1) * (overlapY2 - overlapY1);
};

/** 判断两个标注是否满足重叠阈值条件 */
export const isOverlapThreshold = (a, b, threshold) => {
  const overlapArea = calcOverlapArea(a, b);
  if (overlapArea === 0) return false;

  // 重叠比例 = 重叠面积 / 较小标注的面积（避免因标注大小差异导致误判）
  const areaA = calcRectArea(a);
  const areaB = calcRectArea(b);
  const minArea = Math.min(areaA, areaB);
  const overlapRatio = (overlapArea / minArea) * 100;

  return overlapRatio >= threshold;
};

/** 找出所有重叠的标注组（处理关联重叠：A与B重叠，B与C重叠 → 归为一组） */
export const findOverlapGroups = (dets, threshold) => {
  const groups = []; // 存储重叠组，每个组是标注ID数组
  const detMap = new Map(); // key: det.id, value: det对象+面积

  // 初始化detMap
  dets.forEach((det) => {
    detMap.set(det.id, {
      ...det,
      area: calcRectArea(det)
    });
  });

  // 遍历所有标注，寻找重叠组
  const processedIds = new Set();
  dets.forEach((det) => {
    if (processedIds.has(det.id)) return;

    // 初始化当前组，包含当前标注
    const currentGroup = [det.id];
    processedIds.add(det.id);
    const currentDet = detMap.get(det.id);

    // 查找与当前组中任何标注重叠的其他标注
    const groupToCheck = [currentDet];
    while (groupToCheck.length > 0) {
      const checkDet = groupToCheck.shift();

      dets.forEach((otherDet) => {
        if (otherDet.id === checkDet.id || processedIds.has(otherDet.id)) return;

        const otherDetWithArea = detMap.get(otherDet.id);
        if (isOverlapThreshold(checkDet, otherDetWithArea, threshold)) {
          currentGroup.push(otherDet.id);
          processedIds.add(otherDet.id);
          groupToCheck.push(otherDetWithArea);
        }
      });
    }

    // 只保留包含多个标注的组（单个标注不构成重叠组）
    if (currentGroup.length > 1) {
      groups.push(currentGroup);
    }
  });

  return groups;
};

export const maxminArea = (objects) => {
  if (!objects || objects.length === 0) return [0, 0];

  const withArea = objects.map((obj) => {
    const width = obj.x2 - obj.x1;
    const height = obj.y2 - obj.y1;
    const area = width * height;
    return { ...obj, width, height, area };
  });

  const areas = withArea.map((o) => o.area);
  const maxArea = Math.max(...areas);
  const minArea = Math.min(...areas);

  console.log("maxArea", maxArea);
  console.log("minArea", minArea);

  return [minArea, maxArea];
};
