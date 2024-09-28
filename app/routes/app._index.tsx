import { useState, useCallback, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Button,
  BlockStack,
  TextField,
  ResourceList,
  ResourceItem,
  Thumbnail,
  Text,
  Banner,
  InlineStack,
  Tooltip,
  Spinner,
  Modal,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { MinimizeIcon, EditIcon, ViewIcon } from '@shopify/polaris-icons';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
    query {
      products(first: 20) {
        edges {
          node {
            id
            title
            onlineStoreUrl
            featuredImage {
              url
            }
            variants(first: 5) {
              edges {
                node {
                  id
                  title
                  price
                }
              }
            }
            descriptionHtml
          }
        }
      }
    }`
  );

  const responseJson = await response.json();
  return json({ products: responseJson.data.products.edges });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const productId = formData.get("productId") as string;
  const action = formData.get("action") as string;

  if (!productId) {
    return json({ error: "Product ID is required" }, { status: 400 });
  }

  if (action === "update") {
    const description = formData.get("description") as string;
    try {
      const productResponse = await admin.graphql(
        `#graphql
        mutation updateProductDescription($input: ProductInput!) {
          productUpdate(input: $input) {
            product {
              id
              onlineStoreUrl
              onlineStorePreviewUrl
            }
          }
        }`,
        {
          variables: {
            input: {
              id: productId,
              descriptionHtml: description,
            },
          },
        }
      );
      const productData = await productResponse.json();
      const onlineStoreUrl = productData.data.productUpdate.product.onlineStoreUrl || productData.data.productUpdate.product.onlineStorePreviewUrl;
      return json({ success: true, onlineStoreUrl });
    }
    catch (e) {
      console.error(e);
      return json({ error: "Failed to update product description" }, { status: 500 });
    }
  }

  const productResponse = await admin.graphql(
    `#graphql
    query($productId: ID!) {
      product(id: $productId) {
        title
        featuredImage {
          url
        }
        variants(first: 5) {
          edges {
            node {
              title
              price
            }
          }
        }
      }
    }`,
    {
      variables: {
        productId,
      },
    }
  );

  const productData = await productResponse.json();
  const productTitle = productData.data.product.title;
  const variants = productData.data.product.variants.edges.map((edge: any) => `${edge.node.title} - $${edge.node.price}`);
  const imageUrl = productData.data.product.featuredImage?.url;

  let imageBase64;
  if (imageUrl) {
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    imageBase64 = Buffer.from(imageBuffer).toString('base64');
  }

  const requestData = {
    model: "claude-3-opus-20240229",
    max_tokens: 1000,
    system: "You are a professional product copywriter specializing in creating compelling and SEO-friendly product descriptions.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Generate an engaging product description for the following product:
  Title: ${productTitle}
  Variants: ${variants.join(', ')}
  Please provide a compelling product description that highlights key features, benefits, and unique selling points. Ensure the description is SEO-friendly and approximately 150-200 words long.${imageUrl ? ' Use the provided image for additional context.' : ''}`
          },
          ...(imageBase64 ? [{
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: imageBase64
            }
          }] : [])
        ]
      }
    ]
  };

  try {
    const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": process.env.CLAUDE_API_SECRET || "",
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(requestData),
    });
    if (!aiResponse.ok) {
      const errorMessage = `API request failed with status ${aiResponse.status}`;
      console.error(errorMessage);
      return json({
        description: 'Failed to generate description. Let`s try use this one for demo purposes.',
      });
    }

    const aiResponseJson = await aiResponse.json();

    console.log('AI response:', aiResponseJson);

    if (!aiResponseJson.content || !aiResponseJson.content[0] || !aiResponseJson.content[0].text) {
      const errorMessage = 'Unexpected response format from AI API';
      console.error(errorMessage);
      return json({
        description: 'Failed to generate description. Let`s try use this one for demo purposes.',
      });
    }

    return json({
      description: aiResponseJson.content[0].text,
    });
  } catch (error) {
    console.error('Error generating description:', error);
    return json({
      error: 'Failed to generate description. Please try again later.',
    }, { status: 500 });
  }
};

export default function Index() {
  const { products } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigation = useNavigation();
  const [selectedProduct, setSelectedProduct] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);

  const isLoading = fetcher.state === "submitting" || navigation.state === "submitting";

  const handleProductSelect = useCallback((value: string) => {
    setSelectedProduct(value);
    setIsModalOpen(true);
  }, []);

  const handleModalClose = useCallback(() => setIsModalOpen(false), []);

  const generateDescription = useCallback((productId: string) => {
    setIsGeneratingDescription(true);
    setIsModalOpen(false);
    fetcher.submit(
      { productId, action: "generate" },
      { method: "POST" }
    );
  }, [fetcher]);

  const updateDescription = useCallback((productId: string, description: string) => {
    fetcher.submit(
      { productId, description, action: "update" },
      { method: "POST" }
    );
  }, [fetcher]);

  const selectedProductDetails = products.find((product: any) => product.node.id === selectedProduct)?.node;

  useEffect(() => {
    if (fetcher.data?.error || fetcher.data?.description) {
      setIsGeneratingDescription(false);
    }
  }, [fetcher.data?.error, fetcher.data?.description]);

  return (
    <Page>
      <TitleBar title="Remix Meetup" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Text variant="headingXl" as="h1">Welcome to the Remix Meetup</Text>
            <Text variant="bodyLg" as="p">
              This app leverages the power of AI to create compelling product descriptions for your Shopify store.
              Select a product from the list below to get started!
            </Text>
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          {fetcher.data?.error && (
            <Banner tone="critical" title="Error">
              <p>{fetcher.data.error}</p>
            </Banner>
          )}
          {fetcher.data?.description && (
            <Banner tone="info" title="Description Generated">
              <p>Description generated successfully. You can now use or regenerate it.</p>
            </Banner>
          )}
          {fetcher.data?.success && (
            <Banner tone="success" title="Description Updated">
              <p>Description updated successfully! Your product page has been refreshed with the new content.</p>
              {fetcher.data.onlineStoreUrl && (
                <a href={fetcher.data.onlineStoreUrl} target="_blank" rel="noopener noreferrer">View in store</a>
              )}
            </Banner>
          )}
        </Layout.Section>

        {!isGeneratingDescription && !fetcher.data?.description && (
          <Layout.Section>
            <Card>
              <ResourceList
                resourceName={{ singular: 'product', plural: 'products' }}
                items={products}
                renderItem={(item: any) => {
                  const { id, title, featuredImage, variants } = item.node;
                  const media = (
                    <Thumbnail
                      source={featuredImage?.url || ''}
                      alt={title}
                    />
                  );

                  return (
                    <ResourceItem
                      id={id}
                      media={media}
                      accessibilityLabel={`View details for ${title}`}
                      onClick={() => handleProductSelect(id)}
                    >
                      <BlockStack gap="100">
                        <Text variant="bodyMd" fontWeight="bold" as="h3">
                          {title}
                        </Text>
                        <Text variant="bodySm" as="p">
                          {variants.edges.length} variant{variants.edges.length !== 1 ? 's' : ''}
                        </Text>
                      </BlockStack>
                    </ResourceItem>
                  );
                }}
              />
            </Card>
          </Layout.Section>
        )}

        {(isGeneratingDescription || fetcher.data?.description) && selectedProductDetails && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                {isGeneratingDescription ? (
                  <BlockStack gap="400" align="center">
                    <Spinner size="large" />
                    <Text variant="bodyMd" as="p">Generating description...</Text>
                  </BlockStack>
                ) : (
                  <>
                    {selectedProductDetails.featuredImage && (
                      <img
                        src={selectedProductDetails.featuredImage.url}
                        alt={selectedProductDetails.title}
                        style={{ width: '100%', height: 'auto', objectFit: "contain" }}
                      />
                    )}
                    <Text variant="headingMd" as="h2">{selectedProductDetails.title}</Text>
                    <TextField
                      label="AI-Generated Description"
                      value={fetcher.data?.description || ""}
                      multiline={6}
                      readOnly
                      autoComplete="off"
                    />
                    <InlineStack gap="300" align="center">
                      <Button
                        onClick={() => generateDescription(selectedProduct)}
                        loading={isLoading}
                        icon={MinimizeIcon}
                      >
                        Regenerate
                      </Button>
                      <Button
                        onClick={() => updateDescription(selectedProduct, fetcher.data?.description || "")}
                        loading={isLoading}
                        variant="primary"
                        icon={EditIcon}
                      >
                        Use This Description
                      </Button>
                      {fetcher.data?.onlineStoreUrl && (
                        <Tooltip content="View in store">
                          <Button
                            url={fetcher.data.onlineStoreUrl}
                            external
                            icon={ViewIcon}
                          >
                            View in Store
                          </Button>
                        </Tooltip>
                      )}
                    </InlineStack>
                    <Button onClick={() => setIsGeneratingDescription(false)}>
                      Select Another Product
                    </Button>
                  </>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        <Modal
          open={isModalOpen}
          onClose={handleModalClose}
          title={selectedProductDetails?.title || "Product Details"}
          primaryAction={{
            content: 'Generate Description',
            onAction: () => {
              generateDescription(selectedProduct);
            },
          }}
          secondaryActions={[
            {
              content: 'Close',
              onAction: handleModalClose,
            },
          ]}
        >
          <Modal.Section>
            {selectedProductDetails && (
              <BlockStack gap="400">
                {selectedProductDetails.featuredImage && (
                  <img
                    src={selectedProductDetails.featuredImage.url}
                    alt={selectedProductDetails.title}
                    style={{ width: '100%', height: 'auto', objectFit: "contain" }}
                  />
                )}
                <Text variant="bodyMd" as="p">
                  {selectedProductDetails.descriptionHtml ? (
                    <div dangerouslySetInnerHTML={{ __html: selectedProductDetails.descriptionHtml }} />
                  ) : (
                    "No description available. Generate one now!"
                  )}
                </Text>
                <Text variant="bodySm" as="p">
                  Variants: {selectedProductDetails.variants.edges.map((edge: any) => edge.node.title).join(', ')}
                </Text>
              </BlockStack>
            )}
          </Modal.Section>
        </Modal>
      </Layout>
    </Page>
  );
}
