import subprocess
import sys

def get_network_service():
    """自动获取 Wi‑Fi 或以太网服务名称"""
    try:
        result = subprocess.run(
            ["networksetup", "-listallnetworkservices"],
            capture_output=True,
            text=True
        )
        lines = result.stdout.strip().split("\n")
        for line in lines:
            if "Wi-Fi" in line or "以太网" in line or "Ethernet" in line:
                return line.strip()
        print("❌ 未找到网络服务")
        return None
    except Exception as e:
        print(f"❌ 获取服务失败: {e}")
        return None

def get_current_ip_config(service):
    """获取当前网络配置类型：DHCP / Manual"""
    try:
        result = subprocess.run(
            ["networksetup", "-getinfo", service],
            capture_output=True,
            text=True
        )
        return result.stdout
    except:
        return ""

def switch_ip_mode():
    service = get_network_service()
    if not service:
        return

    config_info = get_current_ip_config(service)
    
    # 固定IP配置
    target_ip = "192.168.1.111"
    subnet = "255.255.255.0"
    gateway = "192.168.1.1"

    if "Manual" in config_info or "静态" in config_info:
        # 当前是静态IP → 切换为 DHCP
        print(f"🔄 当前是静态IP，切换为 DHCP...")
        subprocess.run(["networksetup", "-setdhcp", service], check=True)
        print(f"✅ 已切换为 DHCP（自动获取IP）")
    else:
        # 当前是 DHCP → 切换为 静态IP
        print(f"🔄 当前是 DHCP，切换为 静态IP...")
        subprocess.run(
            ["networksetup", "-setmanual", service, target_ip, subnet, gateway],
            check=True
        )
        print(f"✅ 已切换为静态IP")
        print(f"IP: {target_ip}")
        print(f"网关: {gateway}")

if __name__ == "__main__":
    try:
        switch_ip_mode()
    except subprocess.CalledProcessError:
        print("\n❌ 失败！请用 sudo 运行")
        sys.exit(1)