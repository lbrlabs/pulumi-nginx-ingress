import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as fs from 'fs';

// Get the config from the stack
let config = new pulumi.Config()

const stack = pulumi.getStack()
const clusterProject = config.require("clusterProject")
const stackRef = `jaxxstorm/${clusterProject}/${stack}`;

// Get stack references
const cluster = new pulumi.StackReference(stackRef); // # FIXME: make configurable
const provider = new k8s.Provider("k8s", { kubeconfig: cluster.getOutput("kubeConfig") });

// Configuration options
const ns = config.get("namespace") || "nginx-ingress"
const cert = config.require("cert")
const key = config.require("key")

const namespace = new k8s.core.v1.Namespace("ns", {
    metadata: {
        name: ns,
    }
}, { provider: provider });

// set up wild card secret
const wildcardCert = new k8s.core.v1.Secret("wildcard-cert", {
    metadata: { namespace: namespace.metadata.name },
    stringData: { 
        "tls.crt": cert,
        "tls.key": key,
    },
}, { provider: provider });

const wildcardCertName = wildcardCert.metadata.apply(m => m.name);
const namespaceName = namespace.metadata.apply(n => n.name)

// set up nginx-ingress
const nginx = new k8s.helm.v2.Chart("nginx-ingress",
    {
        namespace: namespace.metadata.name,
        chart: "nginx-ingress",
        version: "1.33.5",
        fetchOpts: { repo: "https://kubernetes-charts.storage.googleapis.com/" },
        values: {
            controller: {
                replicaCount: 2,
                service: {
                    type: "LoadBalancer",
                },
                publishService: {
                    enabled: true,
                },
                metrics: {
                    enabled: true,
                },
                extraArgs: {
                    "default-ssl-certificate": pulumi.interpolate `${namespaceName}/${wildcardCertName}`
                }
            },
        }
    },
    { providers: { kubernetes: provider } },
)
