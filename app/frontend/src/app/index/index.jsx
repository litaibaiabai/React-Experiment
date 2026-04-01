import React, { useEffect, useMemo, useState } from "react";
import { Button, Card, Empty, Select, Space, Spin, Tag, Typography, message } from "antd";
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
      error: "未识别"
    };
    return accumulator;
  }, {});

const College = () => {
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [experiments, setExperiments] = useState([]);
  const [experimentKey, setExperimentKey] = useState("");
  const [selectedExperiment, setSelectedExperiment] = useState(null);
  const [cameras, setCameras] = useState(createEmptyCameras);
  const [cameraResultMap, setCameraResultMap] = useState(createEmptyResultMap);

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
            error: "未识别"
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

  const handleAnalyzeAll = async () => {
    if (!experimentKey) {
      message.warning("请先选择实验");
      return;
    }

    setAnalyzing(true);
    try {
      const response = await post("/analyze-cameras", {
        experimentKey,
        cameras
      });

      const nextResultMap = {};
      (response?.data?.cameras || []).forEach((camera) => {
        nextResultMap[camera.id] = camera;
      });

      setSelectedExperiment(response?.data?.experiment || selectedExperiment);
      setCameraResultMap((prev) => ({
        ...prev,
        ...nextResultMap
      }));
      message.success("12路摄像头识别完成");
    } catch (error) {
      message.error(error?.message || "摄像头识别失败");
    } finally {
      setAnalyzing(false);
    }
  };

  const cards = useMemo(
    () =>
      cameras.map((camera) => ({
        ...camera,
        ...(cameraResultMap[camera.id] || {})
      })),
    [cameras, cameraResultMap]
  );

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
            小学科学AI实验识别系统
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
          <Button type="primary" loading={analyzing} onClick={handleAnalyzeAll}>
            开始识别
          </Button>
        </Space>
      </div>

      <div className="camera-grid">
        {cards.map((camera) => (
          <Card
            key={camera.id}
            bordered={false}
            title={camera.name}
            extra={<Tag color={camera.online ? "green" : "default"}>{camera.online ? "在线" : "未连接"}</Tag>}
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
                {camera.error ? <Text type="danger">{camera.error}</Text> : null}
                <div className="state-list">
                  {(camera.stateResults || []).length ? (
                    camera.stateResults.map((state) => (
                      <div className={`state-item ${state.passed ? "passed" : "failed"}`} key={state.state}>
                        <div className="state-header">
                          <span>{state.state}</span>
                          <span>
                            {state.earnedScore}/{state.score} 分
                          </span>
                        </div>
                        <div className="state-requirements">
                          {state.requirements.map((requirement) => (
                            <Tag
                              key={`${state.state}-${requirement.className}`}
                              color={requirement.passed ? "success" : "error"}
                            >
                              {requirement.className}: {requirement.actual}/{requirement.required}
                            </Tag>
                          ))}
                        </div>
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
