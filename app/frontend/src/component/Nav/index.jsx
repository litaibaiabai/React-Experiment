import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import cls from "classnames";
import s from "./index.module.less";
import logo from "@/img/logo.svg";
import token from "@/util/token"; // ✅ 引入 token 工具
import { Button, Modal } from "antd";

const Nav = () => {
  const nav = useNavigate();
  const location = useLocation();
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState(false);

  const MENU_MAIN = [
    { name: "工程管理", key: ["/"], role: 0, list: [] },
    { name: "系统配置", key: ["/mark"], role: 0, list: [] }
  ];

  const selMenu = (item, i) => {
    if (!item.key) return;
    setSel(i);
    nav(item.key[0]);
  };

  const onOk = () => {
    token.clear();
    setOpen(false);
    nav("/login", { replace: true });
  };

  return (
    <div className={s.nav}>
      <label>安诺赛工程报价智能标注平台</label>

      <div className={s.menu}>
        {MENU_MAIN.map((item, i) => (
          <div
            key={i}
            className={cls(s.item, { [s.sel]: item.key.includes(location.pathname) })}
            onClick={() => selMenu(item, i)}
          >
            {item.name}
          </div>
        ))}

        <div className={s.item} onClick={() => setOpen(true)}>
          退出登录
        </div>
      </div>

      {/* 受控弹窗 */}
      <Modal
        title="确认退出登录？"
        open={open}
        onOk={onOk}
        onCancel={() => setOpen(false)}
        okText="确定"
        cancelText="取消"
        zIndex={2000} // 防止被覆盖
        getContainer={false} // 如导航外层有 transform/overflow，可尝试改成 false
      >
        退出后需要重新登录。
      </Modal>
    </div>
  );
};

export default Nav;
