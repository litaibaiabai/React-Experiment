import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Empty, Select, Space, Spin, Switch, Tag, Typography, message } from "antd";
import { get, post } from "@/util/request";
import "./index.less";

const { Title, Text } = Typography;

const createEmptyCameras = () =>
  Array.from({ length: 12 }, (_, index) => ({
    id: `camera-${index + 1}`,
    name: `摄像头 ${index + 1}`,
    rtspUrl: "",
    slot: index + 1
  }));

const createEmptyResultMap = () =>
  createEmptyCameras().reduce((accumulator, camera) => {
    accumulator[camera.id] = {
      ...camera,
      online: false,
      totalScore: 0,
      maxScore: 0,
      stateResults: [],
      classCounts: {},
      error: null
    };
    return accumulator;
  }, {});

const applySequentialScoring = (camera) => {
  const sourceStates = Array.isArray(camera?.stateResults) ? camera.stateResults : [];
  let canEvaluateCurrent = true;

  const stateResults = sourceStates.map((state) => {
    const passed = Boolean(state?.passed);
    const score = Number(state?.score) || 0;
    const earnedScore = Number(state?.earnedScore) || 0;

    if (!canEvaluateCurrent) {
      return {
        ...state,
        passed: false,
        earnedScore: 0,
        blockedByPrevious: true
      };
    }

    canEvaluateCurrent = passed;
    return {
      ...state,
      passed,
      score,
      earnedScore,
      blockedByPrevious: false
    };
  });

  const totalScore = stateResults.reduce((sum, state) => sum + (Number(state?.earnedScore) || 0), 0);
  const maxScore = stateResults.reduce((sum, state) => sum + (Number(state?.score) || 0), 0);

  return {
    ...camera,
    stateResults,
    totalScore,
    maxScore: camera?.maxScore || maxScore
  };
};

const College = () => {
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [isRealtime, setIsRealtime] = useState(false);
  const [whitelistOnly, setWhitelistOnly] = useState(false);
  const [lastUpdateAt, setLastUpdateAt] = useState("");
  const [experiments, setExperiments] = useState([]);
  const [experimentKey, setExperimentKey] = useState("");
  const [selectedExperiment, setSelectedExperiment] = useState(null);
  const [cameras, setCameras] = useState(createEmptyCameras);
  const [cameraResultMap, setCameraResultMap] = useState(createEmptyResultMap);
  const [focusedCameraId, setFocusedCameraId] = useState(null);
  const analyzingRef = useRef(false);

  useEffect(() => {
    analyzingRef.current = analyzing;
  }, [analyzing]);

  const fetchExperiments = async () => {
    setLoading(true);
    try {
      const response = await get("/experiments");
      const experimentList = response?.data?.experiments || [];
      const cameraList = response?.data?.cameras || createEmptyCameras();
      const activeKey = response?.data?.activeExperimentKey || experimentList[0]?.key || "";
      setExperiments(experimentList);
      setExperimentKey(activeKey);
      setSelectedExperiment(experimentList.find((item) => item.key === activeKey) || null);
      setCameras(cameraList);
      setCameraResultMap(
        cameraList.reduce((accumulator, camera) => {
          accumulator[camera.id] = {
            ...camera,
            online: false,
            totalScore: 0,
            maxScore: 0,
            stateResults: [],
            classCounts: {},
            error: null
          };
          return accumulator;
        }, {})
      );
    } catch (error) {
      message.error(error?.message || "读取实验配置失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExperiments();
  }, []);

  const handleSelectExperiment = async (value) => {
    setExperimentKey(value);
    const matched = experiments.find((item) => item.key === value) || null;
    setSelectedExperiment(matched);

    try {
      setLoading(true);
      await post("/experiments/select", { experimentKey: value });
      message.success(`已切换到 ${matched?.displayName || value}`);
      setCameraResultMap(createEmptyResultMap());
    } catch (error) {
      message.error(error?.message || "实验模型切换失败");
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyzeAll = useCallback(
    async (options = {}) => {
      const { silent = false } = options;
      if (!experimentKey) {
        if (!silent) {
          message.warning("请先选择实验");
        }
        return;
      }

      if (analyzingRef.current) {
        return;
      }

      setAnalyzing(true);
      try {
        const lightweightMode = isRealtime;
        const targetCameraIds = focusedCameraId ? [focusedCameraId] : [];
        const imageCameraIds = focusedCameraId
          ? [focusedCameraId]
          : lightweightMode
            ? []
            : cameras.map((item) => item.id);
        const response = await post("/analyze-cameras", {
          experimentKey,
          cameras,
          whitelistOnly,
          targetCameraIds,
          lightweightMode,
          imageCameraIds
        });

        const nextResultMap = {};
        (response?.data?.cameras || []).forEach((camera) => {
          nextResultMap[camera.id] = camera;
        });

        setSelectedExperiment(response?.data?.experiment || selectedExperiment);
        setCameraResultMap((prev) => ({
          ...Object.keys(nextResultMap).reduce(
            (accumulator, cameraId) => {
              const previousItem = prev[cameraId] || {};
              const incomingItem = nextResultMap[cameraId] || {};
              accumulator[cameraId] = {
                ...previousItem,
                ...incomingItem,
                ...(incomingItem.snapshotBase64 === undefined
                  ? { snapshotBase64: previousItem.snapshotBase64 || null }
                  : {})
              };
              return accumulator;
            },
            { ...prev }
          )
        }));
        setLastUpdateAt(new Date().toLocaleTimeString());
        if (!silent) {
          message.success("识别完成");
        }
      } catch (error) {
        if (!silent) {
          message.error(error?.message || "摄像头识别失败");
        }
      } finally {
        setAnalyzing(false);
      }
    },
    [cameras, experimentKey, selectedExperiment, whitelistOnly, focusedCameraId, isRealtime]
  );

  const startRealtime = () => {
    if (!experimentKey) {
      message.warning("请先选择实验");
      return;
    }

    setIsRealtime(true);
    handleAnalyzeAll({ silent: true });
  };

  const stopRealtime = () => {
    setIsRealtime(false);
  };

  useEffect(() => {
    if (!isRealtime || !experimentKey) {
      return;
    }

    let stopped = false;
    const loop = async () => {
      while (!stopped) {
        await handleAnalyzeAll({ silent: true });
        if (stopped) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };
    loop();

    return () => {
      stopped = true;
    };
  }, [isRealtime, experimentKey, handleAnalyzeAll]);

  const cards = useMemo(
    () =>
      cameras.map((camera) => ({
        ...camera,
        ...applySequentialScoring(cameraResultMap[camera.id] || {})
      })),
    [cameras, cameraResultMap]
  );

  const visibleCards = useMemo(() => {
    if (!focusedCameraId) {
      return cards;
    }
    return cards.filter((camera) => camera.id === focusedCameraId);
  }, [cards, focusedCameraId]);

  const toggleFocus = (cameraId) => {
    setFocusedCameraId((prev) => (prev === cameraId ? null : cameraId));
  };

  if (loading && !experiments.length) {
    return (
      <div className="page-loading">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="experiment-page">
      <div className="top-panel">
        <div>
          <Title level={2} className="title">
            小学科学实验AI测评
          </Title>
        </div>
        <Space wrap>
          <Select
            className="experiment-select"
            value={experimentKey || undefined}
            placeholder="请选择实验"
            options={experiments.map((item) => ({
              label: `${item.displayName}（${item.modelFile}）`,
              value: item.key
            }))}
            onChange={handleSelectExperiment}
          />
          <Button onClick={fetchExperiments}>刷新实验</Button>
          <Space size={6}>
            <Text>仅白名单</Text>
            <Switch checked={whitelistOnly} onChange={setWhitelistOnly} />
          </Space>
          <Button onClick={() => handleAnalyzeAll()}>单次识别</Button>
          <Button type={isRealtime ? "default" : "primary"} loading={analyzing} onClick={startRealtime}>
            开始实时
          </Button>
          <Button danger={isRealtime} onClick={stopRealtime}>
            停止实时
          </Button>
        </Space>
      </div>
      <div className="update-line">
        <Text type="secondary">
          实时状态：{isRealtime ? "运行中（连续刷新）" : "已停止"}
          {isRealtime ? "，轻量传输模式" : "，全量传输模式"}
          {whitelistOnly ? "，白名单模式开启" : "，白名单模式关闭"}
          {lastUpdateAt ? `，最近更新 ${lastUpdateAt}` : ""}
        </Text>
      </div>

      <div className={`camera-grid ${focusedCameraId ? "camera-grid--focus" : ""}`}>
        {visibleCards.map((camera) => (
          <Card
            key={camera.id}
            bordered={false}
            title={camera.name}
            extra={
              <Space>
                <Tag color={camera.online ? "green" : "default"}>{camera.online ? "在线" : "未连接"}</Tag>
                <Button size="small" onClick={() => toggleFocus(camera.id)}>
                  {focusedCameraId === camera.id ? "恢复" : "放大"}
                </Button>
              </Space>
            }
          >
            <div className="card-body">
              <div className="snapshot-box">
                {camera.snapshotBase64 ? (
                  <img src={`data:image/jpeg;base64,${camera.snapshotBase64}`} alt={camera.name} />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无截图" />
                )}
              </div>
              <div className="status-panel">
                <div className="score-line">
                  <Text>总分</Text>
                  <Title level={4}>
                    {camera.totalScore || 0}
                    <span> / {camera.maxScore || 0}</span>
                  </Title>
                </div>
                {camera.error ? <Text type="danger">摄像头连接失败</Text> : null}
                <div className="state-list">
                  {(camera.stateResults || []).length ? (
                    camera.stateResults.map((state) => (
                      <div
                        className={`state-item ${
                          state.blockedByPrevious ? "blocked" : state.passed ? "passed" : "failed"
                        }`}
                        key={state.state}
                      >
                        <div className="state-header">
                          <span>{state.state}</span>
                          <span>
                            {state.earnedScore}/{state.score} 分
                          </span>
                        </div>
                        {state.blockedByPrevious ? <Text type="secondary">等待上一状态完成</Text> : null}
                      </div>
                    ))
                  ) : (
                    <Text type="secondary">等待识别结果</Text>
                  )}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default College;
