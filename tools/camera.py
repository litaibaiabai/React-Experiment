import cv2


RTSP_URL = "rtsp://admin:@192.168.1.11:554/Streaming/Channels/101"
# =================================================================

def view_camera():
    # 1. 创建视频捕获对象，连接 RTSP 流
    cap = cv2.VideoCapture(RTSP_URL)

    # 2. 检查是否成功连接
    if not cap.isOpened():
        print("❌ 无法连接摄像头，请检查：")
        print("   1. 网络是否连通（能否 ping 通 192.168.1.10）")
        print("   2. RTSP 地址、账号密码是否正确")
        print("   3. 摄像头是否开启了 RTSP 协议")
        return

    print("✅ 成功连接摄像头！按键盘 'q' 键退出查看。")

    # 3. 循环读取并显示视频帧
    while True:
        # 读取一帧图像
        ret, frame = cap.read()

        # 如果读取失败（可能是网络中断或流结束），退出循环
        if not ret:
            print("⚠️ 无法获取视频帧，连接可能中断。")
            break

        # 显示图像（窗口标题为 "Camera Live View"）
        cv2.imshow("Camera Live View", frame)

        # 检测键盘输入：按 'q' 键退出（等待 1 毫秒）
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    # 4. 释放资源，关闭窗口
    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    view_camera()