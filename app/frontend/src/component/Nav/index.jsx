import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import cls from "classnames";
import s from "./index.module.less";
import logo from "@/img/logo.svg";
import token from "@/util/token";
import { Button, Modal } from "antd";

// 顶部导航：负责模块切换和退出登录。
const Nav = () => {
  const nav = useNavigate();
  const location = useLocation();
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState(false);

  // 当前项目的主菜单项。
  const MENU_MAIN = [
    { name: "工程管理", key: ["/"], role: 0, list: [] },
    { name: "系统配置", key: ["/mark"], role: 0, list: [] }
  ];

  // 选择菜单后切换到对应路由。
  const selMenu = (item, i) => {
    if (!item.key) return;
    setSel(i);
    nav(item.key[0]);
  };

  // 清空登录态并跳转到登录页。
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

      <Modal
        title="确认退出登录？"
        open={open}
        onOk={onOk}
        onCancel={() => setOpen(false)}
        okText="确定"
        cancelText="取消"
        zIndex={2000}
        getContainer={false}
      >
        退出后需要重新登录。
      </Modal>
    </div>
  );
};

export default Nav;
