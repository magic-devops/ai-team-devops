# 微服务开发规范

> 版本: v1.0 | 更新: 2026-05-12
> 参考: 12-Factor App + Spring Cloud 2024 + Kubernetes 最佳实践

## 1. 何时拆分微服务

**不要过早拆分**。满足以下条件再考虑：
- 单体应用部署时间 > 10 分钟
- 不同模块需要独立扩缩容
- 不同团队负责不同模块
- 模块间有明确的业务边界

**先单体，后微服务**（Monolith First）。

## 2. 服务拆分原则

```
按业务领域拆分（DDD 限界上下文）：
  ✅ 用户服务（user-service）
  ✅ 订单服务（order-service）
  ✅ 支付服务（payment-service）
  ✅ 通知服务（notification-service）

❌ 按技术层拆分：
  ❌ controller-service
  ❌ database-service
```

## 3. 服务间通信

| 场景 | 推荐方式 | 说明 |
|------|---------|------|
| 同步查询 | REST / gRPC | 需要立即响应 |
| 异步事件 | Kafka / RabbitMQ | 解耦，最终一致性 |
| 服务发现 | Nacos / Consul | 动态注册与发现 |

```java
// ✅ 服务间调用用 OpenFeign
@FeignClient(name = "user-service", fallback = UserClientFallback.class)
public interface UserClient {
    @GetMapping("/api/v1/users/{id}")
    ApiResponse<UserDTO> getUser(@PathVariable Long id);
}

// ✅ 熔断降级
@Component
public class UserClientFallback implements UserClient {
    @Override
    public ApiResponse<UserDTO> getUser(Long id) {
        return ApiResponse.error(5003, "用户服务暂时不可用");
    }
}
```

## 4. 配置管理

```yaml
# ✅ 使用 Nacos / Spring Cloud Config 集中管理配置
spring:
  cloud:
    nacos:
      config:
        server-addr: ${NACOS_ADDR}
        namespace: ${SPRING_PROFILES_ACTIVE}
        file-extension: yaml
```

**规范**：
- 所有服务配置集中在配置中心
- 敏感配置（密钥）使用 Vault 或 K8s Secret
- 配置变更不需要重启服务（动态刷新）

## 5. 链路追踪

```java
// ✅ 使用 Micrometer Tracing（Spring Boot 3.x）
// 自动注入 traceId 到日志和响应头
// 配合 Zipkin / Jaeger 可视化

// 日志格式包含 traceId
// [traceId=abc123] 用户登录: email=user@example.com
```

## 6. 健康检查

```yaml
# application.yml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
  endpoint:
    health:
      show-details: when-authorized
      probes:
        enabled: true  # K8s liveness/readiness probe
```

## 7. K8s 部署规范

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: user-service
          image: registry/user-service:${VERSION}
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits: { cpu: 500m, memory: 512Mi }
          livenessProbe:
            httpGet: { path: /actuator/health/liveness, port: 8080 }
            initialDelaySeconds: 30
          readinessProbe:
            httpGet: { path: /actuator/health/readiness, port: 8080 }
            initialDelaySeconds: 10
          env:
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef: { name: db-secret, key: password }
```
