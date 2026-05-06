import { Suspense, lazy } from "react";
import { HashRouter as Router, Routes, Route } from "react-router-dom";
import { Spin } from "antd";
const Index = lazy(() => import("./app/index"));

// 懒加载时的全屏等待态，避免页面首次切入时出现空白。
const Loading = () => (
  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
    <Spin size="large" />
  </div>
);

// 应用路由入口，目前只有主工作台路由。
function App() {
  return (
    <Router>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Index />} />
        </Routes>
      </Suspense>
    </Router>
  );
}

export default App;
